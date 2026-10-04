import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import type { Logger } from "@eyadex/observability";

/** Nest injection tokens for what the shutdown hook needs (apiModule provides them). */
export const SHUTDOWN = Symbol("SHUTDOWN");
export const UNCLEAN = Symbol("UNCLEAN");
export const LOGS = Symbol("LOGS");

const SHUTDOWN_TIMEOUT_MS = 10_000;
// Past the release budget above: a release that is still inside its own timeout is not a stuck shutdown,
// and the orchestrator's stop grace period must exceed this, or it kills the process before the exit 0.
export const SHUTDOWN_WATCHDOG_MS = 20_000;

// A lifecycle provider, so cleanup runs through Nest's own shutdown path — the one SIGTERM triggers —
// and not through an override of app.close() that a signal would skip.
@Injectable()
export class ShutdownHook implements OnApplicationShutdown {
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
      // Referenced on purpose: when every server handle is already closed and a hook awaits a promise that
      // never settles, an unref'd timer would let Node drain and exit 0 before it fired. A clean shutdown
      // ends in process.exit (useProcessExit), so this timer never delays one.
      setTimeout(() => {
        logger.fatal({ signal }, "api shutdown timed out");
        onTimeout(signal);
      }, timeoutMs);
    });
  }
}
