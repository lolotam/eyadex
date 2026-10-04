import { createLogger } from "@eyadex/observability";

import { readConfig } from "./shared/config.ts";
import { WORKER_LOG_EVENTS } from "./shared/log-events.ts";
import { createWorker, SHUTDOWN_WATCHDOG_MS, watchShutdown } from "./worker.ts";

const config = readConfig(process.env);
const logger = createLogger(config.LOG_LEVEL, { events: WORKER_LOG_EVENTS });

try {
  const worker = await createWorker({}, logger);
  // SIGTERM/SIGINT run the same shutdown path an app.close() does (CLAUDE.md §10). useProcessExit: Nest
  // would otherwise re-raise the signal once the hooks are done, and the orchestrator reads that exit (143)
  // as a crash; with it a finished shutdown — release included — exits 0, and the watchdog below is what a
  // shutdown that never finishes gets instead.
  // Only the stop signals: an empty list would also catch SIGSEGV/SIGABRT and turn a crash into exit 0.
  worker.enableShutdownHooks(["SIGTERM", "SIGINT"], { useProcessExit: true });
  watchShutdown({ logger, timeoutMs: SHUTDOWN_WATCHDOG_MS });
  await worker.listen({ host: config.WORKER_HOST, port: config.WORKER_PORT });
  logger.info({ capability: { name: "WORKER", state: "LISTENING" } }, "worker started");
} catch (error) {
  // Only the sanitised diagnostic is logged — the error's message can carry an environment value.
  logger.fatal({ err: error }, "worker failed to start");
  process.exit(1);
}
