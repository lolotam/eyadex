import "reflect-metadata";

import {
  Inject,
  Injectable,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
  type Type,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { systemUuidV7, type IdGenerator } from "@eyadex/ids";
import {
  createLogger,
  enterRequestContext,
  withRequestContext,
  type Logger,
  type RequestContext,
} from "@eyadex/observability";
import { LogController, type FastifyReply, type FastifyRequest } from "fastify";

import { EnvelopeExceptionFilter } from "./shared/exception.filter.ts";
import { HealthController } from "./shared/health.controller.ts";
import { API_LOG_EVENTS } from "./shared/log-events.ts";
import { PinoNestLogger } from "./shared/nest-logger.ts";
import { ApiError, codeForStatus } from "./shared/errors.ts";

export interface AppDependencies {
  /** UUID v7 for rows the use cases create; the system clock and Web Crypto unless a test injects its own. */
  readonly ids?: IdGenerator;
  /** Releases what main.ts opened. Runs on app.close() and on SIGTERM/SIGINT. */
  readonly onShutdown?: () => Promise<void>;
  /**
   * What a signal-triggered shutdown whose release failed or timed out does once it is logged. Nest swallows
   * an error thrown from onApplicationShutdown and then exits 0 (useProcessExit), so the hook cannot throw
   * its way to a non-zero exit: production exits 1 here, a test records the call.
   */
  readonly onUncleanShutdown?: (signal: string) => void;
}

export interface AppOptions {
  /** The shared sanitising logger — main.ts builds it from the validated LOG_LEVEL; tests pass a sink. */
  readonly logger?: Logger;
  /** Test-only: extra controllers mounted beside the real ones. */
  readonly controllers?: readonly Type<unknown>[];
}

const SHUTDOWN = Symbol("SHUTDOWN");
const UNCLEAN = Symbol("UNCLEAN");
const LOGS = Symbol("LOGS");
const REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;
const SHUTDOWN_TIMEOUT_MS = 10_000;
// Past the release budget above: a release that is still inside its own timeout is not a stuck shutdown,
// and the orchestrator's stop grace period must exceed this, or it kills the process before the exit 0.
export const SHUTDOWN_WATCHDOG_MS = 20_000;

// Each request's own log context, looked up by the request so a callback running elsewhere can restore it.
const contexts = new WeakMap<FastifyRequest, RequestContext>();

// One line per request with safe, structural fields only: the route PATTERN, never the raw URL, whose path
// segments and query string can carry tokens, civil IDs or phone numbers.
function logCompleted(request: FastifyRequest, reply: FastifyReply): void {
  const write = () =>
    request.log.info(
      {
        http: {
          method: request.method,
          route: request.routeOptions.url ?? "[unmatched]",
          status: reply.statusCode,
          ms: Math.round(reply.elapsedTime),
        },
      },
      "request completed",
    );
  const context = contexts.get(request);
  if (context === undefined) write();
  else withRequestContext(context, write);
}

// A lifecycle provider, so cleanup runs through Nest's own shutdown path — the one SIGTERM triggers —
// and not through an override of app.close() that a signal would skip.
@Injectable()
class ShutdownHook implements OnApplicationShutdown {
  readonly #logger: Logger;
  readonly #release: () => Promise<void>;
  readonly #onUnclean: (signal: string) => void;

  constructor(
    @Inject(LOGS) logger: Logger,
    @Inject(SHUTDOWN) release: () => Promise<void>,
    @Inject(UNCLEAN) onUnclean: (signal: string) => void,
  ) {
    this.#logger = logger;
    this.#release = release;
    this.#onUnclean = onUnclean;
  }

  // `signal` is Nest's own argument: SIGTERM/SIGINT when a signal arrived, undefined on an explicit
  // close(). The two lines are what an operator reads to tell a clean stop from a release that hung.
  async onApplicationShutdown(signal?: string): Promise<void> {
    const trigger = signal ?? "app.close()";
    this.#logger.info({ signal: trigger }, "api shutdown started");
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
    if (outcome === "released") this.#logger.info(fields, "api shutdown completed");
    else if (outcome === "timed out") this.#logger.error(fields, "api shutdown timed out");
    else this.#logger.error({ ...fields, err: failure }, "api shutdown failed");
    // A drain that failed or hung is not a clean stop: on a signal the orchestrator must see a non-zero exit.
    // An explicit close() (tests, a caller that handles it) only gets the log line.
    if (outcome !== "released" && signal !== undefined) this.#onUnclean(signal);
  }
}

@Module({})
class ApiModule {}

/** The Nest module this API serves: `/v1/health` plus whatever a test mounts beside it. */
export function apiModule(
  deps: AppDependencies,
  logger: Logger,
  controllers: readonly Type<unknown>[] = [],
): DynamicModule {
  return {
    module: ApiModule,
    controllers: [HealthController, ...controllers],
    providers: [
      { provide: SHUTDOWN, useValue: deps.onShutdown ?? (async () => undefined) },
      { provide: UNCLEAN, useValue: deps.onUncleanShutdown ?? (() => process.exit(1)) },
      { provide: LOGS, useValue: logger },
      ShutdownHook,
    ],
  };
}

/**
 * Kills the process when a shutdown that a signal started never finishes. Nest bounds the release itself,
 * but a hook added later can still never return; without this the orchestrator waits out its whole stop
 * grace period and reports a crash. The normal path exits 0 (useProcessExit), so a non-zero exit means the
 * shutdown genuinely failed.
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
      // Unref'd: the timer must never be the reason the process stays alive.
      setTimeout(() => {
        logger.fatal({ signal }, "api shutdown timed out");
        onTimeout(signal);
      }, timeoutMs).unref();
    });
  }
}

/**
 * The logger Fastify itself holds. Fastify announces every address it bound with a bare string
 * ("Server listening at http://…") — one line per interface, and text that is not a catalogued event, so
 * the sanitiser would print each of them as a placeholder that says nothing. Only a bare string is dropped
 * here: every line this codebase writes passes a log object first, and a per-request logger is a real pino
 * child of the shared logger, so request lines are untouched.
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
 * Fastify with the shared sanitising logger, one request id per request, and the envelope for the errors
 * Fastify raises before Nest ever sees the request.
 *
 * @param logger the sanitising logger
 * @param ids    the UUID v7 generator behind a missing or forged request id
 * @returns the adapter, before any route is registered
 */
export function apiAdapter(logger: Logger, ids: IdGenerator): FastifyAdapter {
  const adapter = new FastifyAdapter({
    loggerInstance: frameworkLogger(logger),
    // A caller's X-Request-Id is kept when it is a plain token (so a trace spans the web app and the API);
    // anything else — too long, or with characters that could forge a log line — is replaced with a UUID v7.
    genReqId: (request: { headers: Record<string, string | string[] | undefined> }) => {
      const given = request.headers["x-request-id"];
      return typeof given === "string" && REQUEST_ID.test(given) ? given : ids.newId();
    },
    // Fastify's own request log serialises the raw URL; we log one safe line per request instead (below).
    // Its per-request error lines go too — the envelope filter logs unhandled errors through the sanitiser.
    // One id per line, under the field name the request context uses (CLAUDE.md §8): Fastify's own default
    // label would print it a second time, under a second name, on every line of that request.
    logController: new LogController({
      disableRequestLogging: true,
      requestIdLogLabel: "request_id",
    }),
    // A malformed URL (e.g. `/%ZZ`) is rejected by Fastify's router before Nest runs; answer with the
    // envelope instead of Fastify's default body, which echoes the malformed input.
    frameworkErrors: (error: unknown, request: FastifyRequest, reply: FastifyReply) => {
      const status = (error as { statusCode?: unknown }).statusCode;
      // A missing status (a malformed URL) is a bad request; a server-side failure stays a 500.
      const apiError = new ApiError(
        typeof status === "number" ? codeForStatus(status) : "validation",
      );
      // The router rejected this request before any hook ran: give it its id and its log lines here.
      const context = enterRequestContext(request.id);
      contexts.set(request, context);
      void reply.header("x-request-id", request.id);
      if (apiError.code === "unknown") request.log.error({ err: error }, "unhandled error");
      void reply.code(apiError.status).send(apiError.toEnvelope());
      logCompleted(request, reply);
    },
  });
  // Every log line of the request carries its id. The context is kept on the request: with HTTP pipelining,
  // Node flushes a finished response from ANOTHER request's completion, so onResponse must log inside this
  // request's own context, never whatever is current.
  adapter.getInstance().addHook("onRequest", async (request, reply) => {
    contexts.set(request, enterRequestContext(request.id));
    void reply.header("x-request-id", request.id);
  });
  adapter.getInstance().addHook("onResponse", async (request, reply) => {
    logCompleted(request, reply);
  });
  return adapter;
}

/**
 * The wiring every entry point shares: everything under `/v1`, and the envelope for every error.
 *
 * @param app the application Nest created, on any adapter
 * @returns the initialised application, not yet listening
 */
export async function startApi(app: NestFastifyApplication): Promise<NestFastifyApplication> {
  app.setGlobalPrefix("v1");
  app.useGlobalFilters(new EnvelopeExceptionFilter());
  await app.init();
  return app;
}

/**
 * Builds the API: NestJS on Fastify, the shared sanitising logger, one request id per request echoed in the
 * response, the error envelope for every error — including the ones Fastify raises before Nest sees the
 * request — and `/v1/health` as the only route.
 *
 * @param deps    what the app needs; ports arrive with later slices
 * @param options the sanitising logger, plus test hooks that are never set in production
 * @returns an initialised application, not yet listening
 */
export async function createApp(
  deps: AppDependencies,
  options: AppOptions = {},
): Promise<NestFastifyApplication> {
  const logger = options.logger ?? createLogger("info", { events: API_LOG_EVENTS });
  const app = await NestFactory.create<NestFastifyApplication>(
    apiModule(deps, logger, options.controllers ?? []),
    apiAdapter(logger, deps.ids ?? systemUuidV7()),
    // abortOnError: false — an initialisation error is thrown to the caller (main.ts logs it sanitised and
    // exits) instead of Nest exiting the process itself.
    { logger: new PinoNestLogger(logger), abortOnError: false },
  );
  return startApi(app);
}
