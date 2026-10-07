import { createDatabase, createDispatcherOutbox } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";
import { createLogger } from "@eyadex/observability";
import { SecretSealer } from "@eyadex/secrets";

import { invitationDispatcher } from "./invitation-mail/dispatch-invitation.ts";
import { INVITATION_EVENT_TYPES } from "./invitation-mail/domain/invitation-event.ts";
import { ResendMailSender } from "./invitation-mail/mail/resend-mail-sender.ts";
import { PgInvitationStateReader } from "./invitation-mail/persistence/pg-invitation-state-reader.ts";
import { readConfig } from "./shared/config.ts";
import { WORKER_LOG_EVENTS } from "./shared/log-events.ts";
import { OutboxPoller } from "./shared/outbox-poller.ts";
import { createWorker, SHUTDOWN_WATCHDOG_MS, watchShutdown } from "./worker.ts";

const config = readConfig(process.env);
const logger = createLogger(config.LOG_LEVEL, { events: WORKER_LOG_EVENTS });

try {
  // Both pools are lazy: nothing connects until the first claim, so boot never needs the database.
  const app = createDatabase({ url: config.DATABASE_URL, role: "eyadex_app", ids: systemUuidV7() });
  const outbox = createDispatcherOutbox({ url: config.DISPATCHER_DATABASE_URL });
  const clock = { now: () => new Date() };
  const poller = new OutboxPoller({
    outbox,
    types: INVITATION_EVENT_TYPES,
    now: clock.now,
    intervalMs: config.OUTBOX_POLL_INTERVAL_MS,
    logger,
    handle: invitationDispatcher({
      sealer: new SecretSealer(config.OUTBOX_SEAL_KEY),
      invitations: new PgInvitationStateReader(app),
      mail: new ResendMailSender({ apiKey: config.RESEND_API_KEY, from: config.MAIL_FROM }),
      clock,
      appUrl: config.APP_URL,
      logger,
    }),
  });
  const worker = await createWorker(
    {
      stop: () => poller.stop(),
      readiness: { app: () => app.ping(), dispatcher: () => outbox.ping() },
      release: async () => {
        await Promise.all([app.close(), outbox.close()]);
      },
    },
    logger,
  );
  // SIGTERM/SIGINT run the same shutdown path an app.close() does (CLAUDE.md §10). useProcessExit: Nest
  // would otherwise re-raise the signal once the hooks are done, and the orchestrator reads that exit (143)
  // as a crash; with it a finished shutdown — release included — exits 0, and the watchdog below is what a
  // shutdown that never finishes gets instead.
  // Only the stop signals: an empty list would also catch SIGSEGV/SIGABRT and turn a crash into exit 0.
  worker.enableShutdownHooks(["SIGTERM", "SIGINT"], { useProcessExit: true });
  watchShutdown({ logger, timeoutMs: SHUTDOWN_WATCHDOG_MS });
  await worker.listen({ host: config.WORKER_HOST, port: config.WORKER_PORT });
  poller.start();
  logger.info({ capability: { name: "WORKER", state: "LISTENING" } }, "worker started");
} catch (error) {
  // Only the sanitised diagnostic is logged — the error's message can carry an environment value.
  logger.fatal({ err: error }, "worker failed to start");
  process.exit(1);
}
