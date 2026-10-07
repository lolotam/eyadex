import type { ClaimedEvent, DispatchOutcome } from "@eyadex/db";
import type { Logger } from "@eyadex/observability";
import type { SecretSealer } from "@eyadex/secrets";

import { afterFailure } from "../invitation-mail/domain/retry-schedule.ts";
import { isSuperseded, parseMailProviderTest, TEST_MESSAGE } from "./domain/test-event.ts";
import type {
  ClinicProviderCredentials,
  ClinicSenderFactory,
} from "./ports/clinic-sender-factory.ts";
import type {
  ProviderTestRecord,
  ProviderTestState,
  ProviderTestStore,
} from "./ports/provider-test-store.ts";

export interface MailProviderTestDeps {
  /** مفتاح `MAIL_PROVIDER_SEAL_KEY`، مش `OUTBOX_SEAL_KEY`. */
  readonly sealer: SecretSealer;
  readonly store: ProviderTestStore;
  readonly senders: ClinicSenderFactory;
  readonly clock: { now(): Date };
  readonly logger: Logger;
}

const credentialsOf = (
  provider: NonNullable<ProviderTestState["provider"]>,
  secret: string,
): ClinicProviderCredentials | null => {
  if (provider.kind === "resend") return { kind: "resend", apiKey: secret };
  if (provider.smtpHost === null || provider.smtpPort === null || provider.smtpUser === null) {
    return null;
  }
  return {
    kind: "smtp",
    host: provider.smtpHost,
    port: provider.smtpPort,
    user: provider.smtpUser,
    password: secret,
  };
};

/**
 * إيميل تجربة لمزود العيادة (ADR-0014، 7c-2a). بيروح لإيميل عضوية الأدمن اللي طلبه بس، من مسار العيادة
 * نفسه من غير بديل المنصة. التجربة الفاشلة بيانات على الصف (`last_error`)، والحدث `dispatched` في
 * الحالتين. السطر المسجّل فيه id الحدث ونوعه والنتيجة بس — مفيش إيميل ولا سر ولا نص من المزود.
 */
export function mailProviderTestHandler(deps: MailProviderTestDeps) {
  const log = (event: ClaimedEvent, outcome: string, extra: Record<string, unknown> = {}) =>
    deps.logger.info(
      { outbox: { id: event.id, type: event.type, outcome, ...extra } },
      "outbox event handled",
    );

  const attempt = async (event: ClaimedEvent, version: number, state: ProviderTestState) => {
    const { provider, recipient } = state;
    if (provider === null || isSuperseded(provider.version, version)) {
      log(event, "skipped", { reason: provider === null ? "removed" : "replaced" });
      return null;
    }
    const failed = (error: string): ProviderTestRecord => {
      log(event, "test_failed", { error });
      return { ok: false, error };
    };
    if (recipient === null) return failed("no_recipient");
    let secret: string;
    try {
      secret = deps.sealer.open(provider.sealedCredentials, provider.id);
    } catch {
      return failed("seal_unreadable");
    }
    const credentials = credentialsOf(provider, secret);
    if (credentials === null) return failed("invalid_provider");
    const clinic = deps.senders.open(credentials);
    try {
      const result = await clinic.sender.send({
        to: recipient,
        subject: TEST_MESSAGE.subject,
        html: TEST_MESSAGE.html,
        text: TEST_MESSAGE.text,
        idempotencyKey: event.id,
        from: { name: provider.fromName, address: provider.fromEmail },
        ...(provider.replyTo === null ? {} : { replyTo: provider.replyTo }),
      });
      if (!result.sent) return failed(result.error);
    } finally {
      clinic.close();
    }
    log(event, "test_sent", { provider: provider.kind });
    return { ok: true, at: deps.clock.now() } satisfies ProviderTestRecord;
  };

  return async (event: ClaimedEvent): Promise<DispatchOutcome> => {
    const parsed = parseMailProviderTest(event.payload, event.clinicId);
    if (parsed === null) {
      deps.logger.error(
        { outbox: { id: event.id, type: event.type, outcome: "failed", error: "invalid_payload" } },
        "outbox event failed",
      );
      return { kind: "failed", error: "invalid_payload" };
    }
    try {
      await deps.store.withProvider(parsed.clinicId, parsed.providerId, parsed.actorUserId, (s) =>
        attempt(event, parsed.providerVersion, s),
      );
    } catch {
      // The tenant transaction rolled back: retry on the shared schedule. The raw message is never logged.
      const step = afterFailure(event.attempts, deps.clock.now());
      if (step.kind === "give_up") {
        deps.logger.error(
          { outbox: { id: event.id, type: event.type, outcome: "failed", error: "db_error" } },
          "outbox event failed",
        );
        return { kind: "failed", error: "db_error" };
      }
      log(event, "retry", { error: "db_error", attempt: event.attempts + 1 });
      return { kind: "retry", error: "db_error", nextAttemptAt: step.nextAttemptAt };
    }
    return { kind: "dispatched" };
  };
}
