import { createDatabase, createDispatcherOutbox } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";
import { createLogger } from "@eyadex/observability";
import { SecretSealer } from "@eyadex/secrets";

import { branchDeactivatedHandler } from "./branch-invitations/handle-branch-deactivated.ts";
import { BRANCH_DEACTIVATED } from "./branch-invitations/domain/branch-event.ts";
import { PgOrphanInvitationCanceller } from "./branch-invitations/persistence/pg-orphan-invitation-canceller.ts";
import { expiryReminderDispatcher } from "./expiry-reminder/handle-expiry-reminder.ts";
import { EXPIRY_REMINDER } from "./expiry-reminder/domain/reminder-rules.ts";
import {
  PgDueClinicFinder,
  PgReminderLedger,
  PgReminderStateReader,
} from "./expiry-reminder/persistence/pg-reminder-store.ts";
import { ExpiryReminderScanner } from "./expiry-reminder/scan-expiry-reminders.ts";
import { RetentionPurgeJob } from "./retention/purge-expired-rows.ts";
import { invitationDispatcher } from "./invitation-mail/dispatch-invitation.ts";
import { addressOf } from "./invitation-mail/domain/mail-address.ts";
import { ADMIN_INVITED, USER_INVITED } from "./invitation-mail/domain/invitation-event.ts";
import { decideFallback } from "./invitation-mail/domain/fallback-decision.ts";
import { FallbackMailSender } from "./invitation-mail/mail/fallback-mail-sender.ts";
import { ResendMailSender } from "./invitation-mail/mail/resend-mail-sender.ts";
import { createSmtpTransport, SmtpMailSender } from "./invitation-mail/mail/smtp-mail-sender.ts";
import { PgInvitationStateReader } from "./invitation-mail/persistence/pg-invitation-state-reader.ts";
import { MAIL_PROVIDER_TEST_REQUESTED } from "./mail-provider-test/domain/test-event.ts";
import { mailProviderTestHandler } from "./mail-provider-test/handle-test-requested.ts";
import { RealClinicSenderFactory } from "./mail-provider-test/mail/clinic-sender-factory.ts";
import { PgProviderTestStore } from "./mail-provider-test/persistence/pg-provider-test-store.ts";
import { TEAM_INVITED } from "./platform-invite-mail/domain/team-invite.ts";
import { teamInviteDispatcher } from "./platform-invite-mail/handle-team-invited.ts";
import { PgTeamInviteStateReader } from "./platform-invite-mail/pg-team-invite-state.ts";
import { PATIENT_NOTIFICATION_REQUESTED } from "./patient-notifications/domain/notification-event.ts";
import { PgNotificationStore } from "./patient-notifications/persistence/pg-notification-store.ts";
import {
  PgReminderClinicFinder,
  PgReminderQueue,
} from "./patient-notifications/persistence/pg-reminder-queue.ts";
import { AppointmentReminderScanner } from "./patient-notifications/scan-appointment-reminders.ts";
import { notificationDispatcher } from "./patient-notifications/send-notification.ts";
import { EvolutionWhatsappSender } from "./patient-notifications/whatsapp/evolution-whatsapp-sender.ts";
import { NamedPlatformSender, platformSenderName } from "./shared/named-platform-sender.ts";
import { routeEvents } from "./shared/event-router.ts";
import { medicalCipher, readConfig } from "./shared/config.ts";
import { WORKER_LOG_EVENTS } from "./shared/log-events.ts";
import { OutboxPoller } from "./shared/outbox-poller.ts";
import { createWorker, SHUTDOWN_WATCHDOG_MS, watchShutdown } from "./worker.ts";

const config = readConfig(process.env);
const logger = createLogger(config.LOG_LEVEL, { events: WORKER_LOG_EVENTS });

try {
  // Both pools are lazy: nothing connects until the first claim, so boot never needs the database.
  const ids = systemUuidV7();
  const app = createDatabase({ url: config.DATABASE_URL, role: "eyadex_app", ids });
  const outbox = createDispatcherOutbox({ url: config.DISPATCHER_DATABASE_URL });
  // ADR-0020: clinics + platform_settings for the expiry scan, platform_accounts for team links.
  const platform = createDatabase({
    url: config.PLATFORM_DATABASE_URL,
    role: "eyadex_platform",
    ids,
  });
  // Its own pool for the sender name: a send runs inside the invitation's (app) or the team row's
  // (platform) transaction, and a pool refuses a second transaction nested in its first.
  const settings = createDatabase({
    url: config.DATABASE_URL,
    role: "eyadex_app",
    ids,
    maxConnections: 1,
  });
  const clock = { now: () => new Date() };
  const resend = new ResendMailSender({ apiKey: config.RESEND_API_KEY, from: config.MAIL_FROM });
  // ADR-0014: the SMTP fallback exists only when all four SMTP_* keys are set.
  const smtp = config.SMTP
    ? new SmtpMailSender(createSmtpTransport(config.SMTP), config.MAIL_FROM)
    : null;
  // Story 26: platform mail carries the sender name the platform team chose (ADR-0020).
  const mail = new NamedPlatformSender(
    smtp ? new FallbackMailSender(resend, smtp, decideFallback) : resend,
    addressOf(config.MAIL_FROM),
    platformSenderName(settings),
  );
  const providerSealer = new SecretSealer(config.MAIL_PROVIDER_SEAL_KEY);
  const clinicSenders = new RealClinicSenderFactory();
  const clinicMail = {
    sealer: providerSealer,
    senders: clinicSenders,
    platformFrom: config.MAIL_FROM,
  };
  const mailInvitation = invitationDispatcher({
    sealer: new SecretSealer(config.OUTBOX_SEAL_KEY),
    invitations: new PgInvitationStateReader(app, ids),
    mail,
    // ADR-0014 7c-2b: staff invitations go through a verified, healthy clinic provider.
    clinicMail,
    clock,
    appUrl: config.APP_URL,
    logger,
  });
  // One poller, one type → handler map: a type with no handler is never claimed (ADR-0013 §12).
  const route = routeEvents({
    [ADMIN_INVITED]: mailInvitation,
    [USER_INVITED]: mailInvitation,
    [MAIL_PROVIDER_TEST_REQUESTED]: mailProviderTestHandler({
      sealer: providerSealer,
      store: new PgProviderTestStore(app),
      senders: clinicSenders,
      clock,
      logger,
    }),
    [EXPIRY_REMINDER]: expiryReminderDispatcher({
      state: new PgReminderStateReader(app),
      mail,
      clock,
      logger,
    }),
    [TEAM_INVITED]: teamInviteDispatcher({
      sealer: new SecretSealer(config.OUTBOX_SEAL_KEY),
      accounts: new PgTeamInviteStateReader(platform),
      mail,
      clock,
      platformUrl: config.PLATFORM_URL,
      logger,
    }),
    // Spec §3.3: patient emails try the clinic's primary, then its fallback, then the platform (N-3).
    // Spec §7.1: WhatsApp rows go through the clinic's Evolution instance, or are skipped without it.
    [PATIENT_NOTIFICATION_REQUESTED]: notificationDispatcher({
      store: new PgNotificationStore(app, ids),
      clinicMail,
      platform: mail,
      whatsapp: config.EVOLUTION ? new EvolutionWhatsappSender(config.EVOLUTION) : null,
      cipher: medicalCipher(process.env),
      clock,
      logger,
    }),
    [BRANCH_DEACTIVATED]: branchDeactivatedHandler({
      canceller: new PgOrphanInvitationCanceller(app, ids),
      clock,
      logger,
    }),
  });
  const poller = new OutboxPoller({
    outbox,
    types: route.types,
    handle: route.handle,
    now: clock.now,
    intervalMs: config.OUTBOX_POLL_INTERVAL_MS,
    logger,
  });
  // PRD §4.9: the daily reminder job; once per clinic per expiry date by the 0038 ledger.
  const scanner = new ExpiryReminderScanner({
    finder: new PgDueClinicFinder(platform),
    ledger: new PgReminderLedger(app, ids),
    clock,
    logger,
    intervalMs: config.EXPIRY_SCAN_INTERVAL_MS,
  });
  // Spec §3.2: the appointment reminders; once per appointment start by the 0056 ledger.
  const reminders = new AppointmentReminderScanner({
    finder: new PgReminderClinicFinder(platform),
    queue: new PgReminderQueue(app, ids),
    clock,
    logger,
    intervalMs: config.REMINDER_SCAN_INTERVAL_MS,
  });
  // ADR-0022: the retention purge, on the dispatcher pool — the only role the API never signs in as.
  const retention = new RetentionPurgeJob({
    purger: outbox,
    logger,
    intervalMs: config.RETENTION_PURGE_INTERVAL_MS,
  });
  const worker = await createWorker(
    {
      stop: async () => {
        await Promise.all([poller.stop(), scanner.stop(), reminders.stop(), retention.stop()]);
      },
      readiness: {
        app: () => app.ping(),
        dispatcher: () => outbox.ping(),
        platform: () => platform.ping(),
      },
      release: async () => {
        smtp?.close();
        await Promise.all([app.close(), outbox.close(), platform.close(), settings.close()]);
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
  scanner.start();
  reminders.start();
  retention.start();
  logger.info({ capability: { name: "WORKER", state: "LISTENING" } }, "worker started");
} catch (error) {
  // Only the sanitised diagnostic is logged — the error's message can carry an environment value.
  logger.fatal({ err: error }, "worker failed to start");
  process.exit(1);
}
