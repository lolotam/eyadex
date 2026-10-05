import { systemUuidV7 } from "@eyadex/ids";
import { createLogger } from "@eyadex/observability";

import { createApp, SHUTDOWN_WATCHDOG_MS, watchShutdown } from "./app.ts";
import { readConfig } from "./shared/config.ts";
import { API_LOG_EVENTS } from "./shared/log-events.ts";

const config = readConfig(process.env);
const logger = createLogger(config.LOG_LEVEL, { events: API_LOG_EVENTS });

try {
  // UUID v7 on the system clock and Web Crypto — bound here, at the composition root.
  const app = await createApp(
    { ids: systemUuidV7(), mountAuth: true, mountPlatform: true },
    { logger },
  );
  // useProcessExit: Nest's own shutdown re-raises the signal once the hooks are done, and the orchestrator
  // reads that exit (143) as a crash. With it, a finished shutdown — release included — exits 0, and the
  // watchdog below is what a shutdown that never finishes gets instead.
  // Only the stop signals: an empty list would also catch SIGSEGV/SIGABRT and turn a crash into exit 0.
  app.enableShutdownHooks(["SIGTERM", "SIGINT"], { useProcessExit: true });
  watchShutdown({ logger, timeoutMs: SHUTDOWN_WATCHDOG_MS });
  await app.listen({ host: config.HOST, port: config.PORT });
  logger.info({ capability: { name: "API", state: "LISTENING" } }, "api started");
} catch (error) {
  // Only the sanitised diagnostic is logged — the error's message can carry an environment value.
  logger.fatal({ err: error }, "api failed to start");
  process.exit(1);
}
