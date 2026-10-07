import "reflect-metadata";

import {
  Inject,
  Injectable,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { Logger } from "@eyadex/observability";
import { LogController } from "fastify";

import { HealthController } from "./shared/health.controller.ts";
import { READINESS, ReadyController, type ReadinessChecks } from "./shared/ready.controller.ts";

export interface WorkerDependencies {
  /**
   * Stops polling and waits for the event in flight to record its outcome. Runs first in the shutdown, so
   * no claim still holds a row when `release` closes the pools.
   */
  readonly stop?: () => Promise<void>;
  /** The pools `/health/ready` pings. */
  readonly readiness?: ReadinessChecks;
  /** Releases what main.ts opened. Runs on app.close() and on SIGTERM/SIGINT, after `stop`. */
  readonly release?: () => Promise<void>;
  /**
   * What a signal-triggered shutdown whose release failed or timed out does once it is logged. Nest swallows
   * an error thrown from onApplicationShutdown and then exits 0 (useProcessExit), so the hook cannot throw
   * its way to a non-zero exit: production exits 1 here, a test records the call.
   */
  readonly onUncleanShutdown?: (signal: string) => void;
}

const SHUTDOWN = Symbol("SHUTDOWN");
const STOP = Symbol("STOP");
const UNCLEAN = Symbol("UNCLEAN");
const LOGS = Symbol("LOGS");
// Long enough for the first job's own budget and grace, so a SIGTERM lets the work in flight record its
// outcome instead of abandoning it. The orchestrator's stop grace period must exceed this.
const SHUTDOWN_TIMEOUT_MS = 30_000;
// Past the release budget above: a release still inside its own timeout is not a stuck shutdown, and the
// orchestrator's stop grace period must exceed this too, or it kills the process before the exit 0.
export const SHUTDOWN_WATCHDOG_MS = 45_000;

// Through Nest's shutdown path, the one SIGTERM triggers: stop polling (the event in flight records its
// outcome), then release the pools. The order is the point: no claim may still hold a row when its pool closes.
@Injectable()
class ShutdownHook implements OnApplicationShutdown {
  readonly #logger: Logger;
  readonly #release: () => Promise<void>;
  readonly #stop: () => Promise<void>;
  readonly #onUnclean: (signal: string) => void;

  constructor(
    @Inject(LOGS) logger: Logger,
    @Inject(SHUTDOWN) release: () => Promise<void>,
    @Inject(UNCLEAN) onUnclean: (signal: string) => void,
    @Inject(STOP) stop: () => Promise<void>,
  ) {
    this.#logger = logger;
    this.#release = release;
    this.#stop = stop;
    this.#onUnclean = onUnclean;
  }

  // `signal` is Nest's own argument: SIGTERM/SIGINT when a signal arrived, undefined on an explicit
  // close(). The two lines are what an operator reads to tell a clean stop from a release that hung.
  async onApplicationShutdown(signal?: string): Promise<void> {
    const trigger = signal ?? "app.close()";
    this.#logger.info({ signal: trigger }, "worker shutdown started");
    const startedAt = Date.now();
    let timer: NodeJS.Timeout | undefined;
    let failure: unknown;
    const limit = new Promise<"timed out">((resolve) => {
      timer = setTimeout(() => resolve("timed out"), SHUTDOWN_TIMEOUT_MS);
    });
    const outcome = await Promise.race([
      // Started inside a continuation, so a release that throws before returning its promise is a
      // failed release too, not an escape from this handler.
      Promise.resolve()
        .then(() => this.#stop())
        .then(() => this.#release())
        .then(
          () => "released" as const,
          (error: unknown) => {
            failure = error;
            return "failed" as const;
          },
        ),
      limit,
    ]);
    clearTimeout(timer);
    const fields = { signal: trigger, ms: Date.now() - startedAt };
    // Only a release that finished is a clean stop; a hung or failed drain must not read as one.
    if (outcome === "released") this.#logger.info(fields, "worker shutdown completed");
    else if (outcome === "timed out") this.#logger.error(fields, "worker shutdown timed out");
    else this.#logger.error({ ...fields, err: failure }, "worker shutdown failed");
    // A drain that failed or hung is not a clean stop: on a signal the orchestrator must see a non-zero exit.
    // An explicit close() (tests, a caller that handles it) only gets the log line.
    if (outcome !== "released" && signal !== undefined) this.#onUnclean(signal);
  }
}

@Module({})
class WorkerModule {
  static forRoot(deps: WorkerDependencies, logger: Logger): DynamicModule {
    return {
      module: WorkerModule,
      controllers: [HealthController, ReadyController],
      providers: [
        { provide: STOP, useValue: deps.stop ?? (async () => undefined) },
        { provide: READINESS, useValue: deps.readiness ?? {} },
        { provide: SHUTDOWN, useValue: deps.release ?? (async () => undefined) },
        { provide: UNCLEAN, useValue: deps.onUncleanShutdown ?? (() => process.exit(1)) },
        { provide: LOGS, useValue: logger },
        ShutdownHook,
      ],
    };
  }
}

/**
 * Kills the process when a shutdown that a signal started never finishes. Nest bounds the release itself,
 * but a job-polling step added later can still never return; without this the orchestrator waits out its
 * whole stop grace period and reports a crash. The normal path exits 0 (useProcessExit), so a non-zero exit
 * means the shutdown genuinely failed.
 *
 * @param logger    the sanitising logger, for the one line the watchdog writes
 * @param timeoutMs how long the shutdown may take
 * @param signals   the signals that start it
 * @param onTimeout what giving up does; production exits the process, a test records it
 */
export function watchShutdown({
  logger,
  timeoutMs,
  signals = ["SIGTERM", "SIGINT"],
  onTimeout = () => process.exit(1),
}: {
  readonly logger: Logger;
  readonly timeoutMs: number;
  readonly signals?: readonly string[];
  readonly onTimeout?: (signal: string) => void;
}): void {
  for (const signal of signals) {
    process.once(signal, () => {
      // Referenced on purpose: when every handle is already closed and a hook awaits a promise that never
      // settles, an unref'd timer would let Node drain and exit 0 before it fired. A clean shutdown ends in
      // process.exit (useProcessExit), so this timer never delays one.
      setTimeout(() => {
        logger.fatal({ signal }, "worker shutdown timed out");
        onTimeout(signal);
      }, timeoutMs);
    });
  }
}

/**
 * The logger Fastify itself holds. Fastify announces every address it bound with a bare string
 * ("Server listening at http://…"), and that text is not a catalogued event, so the sanitiser would print
 * it as a placeholder that says nothing. Only a bare string is dropped here: every line this codebase writes
 * passes a log object first, and a per-request logger is a real pino child of the shared logger.
 *
 * @param logger the shared sanitising logger
 * @returns the logger to hand Fastify as its `loggerInstance`
 */
function frameworkLogger(logger: Logger): Logger {
  // A child, not the root: `info` is replaced on this one object only. A per-request logger Fastify derives
  // from it inherits the override, so `this` is honoured — that logger's bindings stay on the line.
  const framework = logger.child({});
  const original = framework.info;
  framework.info = function info(this: Logger, object: unknown, message?: string) {
    if (typeof object !== "string") original.call(this, object, message);
  };
  return framework;
}

/**
 * Builds the worker's Nest application: the liveness route, the shared sanitising logger, and the ordered
 * shutdown Nest triggers on SIGTERM/SIGINT. Nest's console logger is off — a startup error is thrown to
 * main.ts, which logs it sanitised.
 *
 * @param deps   how to release resources once the jobs have stopped
 * @param logger the shared sanitising logger
 * @returns an initialised application, not yet listening
 */
export async function createWorker(
  deps: WorkerDependencies,
  logger: Logger,
): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    loggerInstance: frameworkLogger(logger),
    // One safe line per request is logged by the routes that exist; Fastify's own request log would
    // serialise the raw URL, so it is off.
    logController: new LogController({ disableRequestLogging: true }),
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    WorkerModule.forRoot(deps, logger),
    adapter,
    {
      logger: false,
      abortOnError: false,
    },
  );
  await app.init();
  return app;
}
