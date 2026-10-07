import type { ClaimedEvent, DispatchOutcome } from "@eyadex/db";
import type { Logger } from "@eyadex/observability";
import type { SecretSealer } from "@eyadex/secrets";

import { credentialsOf } from "../mail-provider-test/domain/credentials.ts";
import type { ClinicSenderFactory } from "../mail-provider-test/ports/clinic-sender-factory.ts";
import { isDefinitiveClinicFailure } from "./domain/clinic-failure.ts";
import { routeInvitation } from "./domain/clinic-routing.ts";
import { formatExpiry, renderInvitationEmail } from "./domain/invitation-email.ts";
import { parseInvitationEvent, USER_INVITED } from "./domain/invitation-event.ts";
import { addressOf } from "./domain/mail-address.ts";
import { afterFailure } from "./domain/retry-schedule.ts";
import { skipReason } from "./domain/send-decision.ts";
import type {
  InvitationStateReader,
  LockedClinicProvider,
} from "./ports/invitation-state-reader.ts";
import type { MailMessage, MailResult, MailSender } from "./ports/mail-sender.ts";

export interface Clock {
  now(): Date;
}

export interface InvitationDispatchDeps {
  readonly sealer: SecretSealer;
  readonly invitations: InvitationStateReader;
  readonly mail: MailSender;
  readonly clock: Clock;
  /** origin منطقة العيادة، من غير `/` في الآخر. */
  readonly appUrl: string;
  readonly logger: Logger;
  /** مزود العيادة (ADR-0014، 7c-2b). من غيره كل الرسايل بتروح من المنصة. */
  readonly clinicMail?: ClinicMailDeps;
}

export interface ClinicMailDeps {
  /** مفتاح `MAIL_PROVIDER_SEAL_KEY`. */
  readonly sealer: SecretSealer;
  /** المسار الوحيد لبناء مرسل العيادة: فيه حارس SSRF والتثبيت على العناوين. */
  readonly senders: ClinicSenderFactory;
  /** `MAIL_FROM` المنصة: عنوانه بيتستخدم في الإرسال بالنيابة. */
  readonly platformFrom: string;
}

const DONE: DispatchOutcome = { kind: "dispatched" };

/**
 * بيقرر حدث دعوة واحد والصف ممسوك (ADR-0013): يفتح الرمز بـ id الحدث، يقرا الدعوة تحت عيادتها، يبعت
 * لو لسه صالحة، ويرجع النتيجة اللي الـ outbox بيكتبها. السطر المسجّل فيه id الحدث ونوعه ونتيجته بس.
 */
export function invitationDispatcher(deps: InvitationDispatchDeps) {
  const note = (event: ClaimedEvent, outcome: string, extra: Record<string, unknown> = {}) =>
    deps.logger.info(
      { outbox: { id: event.id, type: event.type, outcome, ...extra } },
      "outbox event handled",
    );

  const fail = (event: ClaimedEvent, error: string): DispatchOutcome => {
    const step = afterFailure(event.attempts, deps.clock.now());
    if (step.kind === "give_up") {
      deps.logger.error(
        { outbox: { id: event.id, type: event.type, outcome: "failed", error } },
        "outbox event failed",
      );
      return { kind: "failed", error };
    }
    note(event, "retry", { error, attempt: event.attempts + 1 });
    return { kind: "retry", error, nextAttemptAt: step.nextAttemptAt };
  };

  // The clinic's own path, no platform fallback inside the attempt: a failure retries with the clinic
  // provider, because an ambiguous failure may already have delivered (ADR-0014, 7c-2b).
  const viaClinic = async (
    clinic: ClinicMailDeps,
    locked: LockedClinicProvider,
    message: MailMessage,
  ): Promise<{ result: MailResult; degraded: boolean }> => {
    const { row } = locked;
    let result: MailResult;
    let secret: string | null = null;
    try {
      secret = clinic.sealer.open(row.sealedCredentials, row.id);
    } catch {
      // Counted as definitive below: a seal that never opens will not open on a retry either.
    }
    const credentials = secret === null ? null : credentialsOf(row, secret);
    if (secret === null) {
      result = { sent: false, error: "seal_unreadable" };
    } else if (credentials === null) {
      result = { sent: false, error: "invalid_provider" };
    } else {
      const sender = await clinic.senders.open(credentials);
      try {
        result = await sender.sender.send({
          ...message,
          from: { name: row.fromName, address: row.fromEmail },
          ...(row.replyTo === null ? {} : { replyTo: row.replyTo }),
        });
      } finally {
        sender.close();
      }
    }
    const degraded = await locked.record(
      result.sent
        ? { ok: true }
        : {
            ok: false,
            error: result.error,
            definitive: isDefinitiveClinicFailure(result.error),
            at: deps.clock.now(),
          },
    );
    return {
      result: result.sent ? { sent: true, provider: row.kind, fallback: false } : result,
      degraded,
    };
  };

  // This attempt degraded the provider: its next attempt goes through the platform, even when the
  // schedule would give up now (ambiguous failures may have used up the earlier attempts).
  const platformNext = (event: ClaimedEvent, error: string): DispatchOutcome => {
    note(event, "retry", { error, reason: "provider_degraded", attempt: event.attempts + 1 });
    return { kind: "retry", error, nextAttemptAt: deps.clock.now() };
  };

  return async (event: ClaimedEvent): Promise<DispatchOutcome> => {
    const invitation = parseInvitationEvent(event.type, event.payload);
    if (invitation === null || invitation.clinicId !== event.clinicId) {
      // Malformed: no retry can fix it, so it is closed and its token scrubbed at once.
      deps.logger.error(
        { outbox: { id: event.id, type: event.type, outcome: "failed", error: "invalid_payload" } },
        "outbox event failed",
      );
      return { kind: "failed", error: "invalid_payload" };
    }
    let token: string;
    try {
      token = deps.sealer.open(invitation.sealedToken, event.id);
    } catch {
      deps.logger.error(
        { outbox: { id: event.id, type: event.type, outcome: "failed", error: "seal_unreadable" } },
        "outbox event failed",
      );
      return { kind: "failed", error: "seal_unreadable" };
    }
    // The invitation row stays locked until the send returns: a resend, copy-link, cancel or accept
    // that arrives meanwhile waits, so the link checked here is the link that is mailed (ADR-0013).
    return deps.invitations.whileLocked(
      invitation.clinicId,
      invitation.invitationId,
      async (state) => {
        // Decision time is after the lock (ADR-0012 §16): an invitation that expired while we waited is skipped.
        const reason = skipReason(state, token, deps.clock.now());
        if (reason !== null || state === null) {
          note(event, "skipped", { reason: reason ?? "missing" });
          return DONE;
        }
        const link = `${deps.appUrl}/invite/${encodeURIComponent(token)}`;
        const email = renderInvitationEmail(
          invitation,
          link,
          formatExpiry(state.expiresAt, invitation.language, state.timezone),
        );
        const message: MailMessage = {
          to: invitation.email,
          subject: email.subject.replace(/[\r\n]+/g, " "),
          html: email.html,
          text: email.text,
          idempotencyKey: event.id,
        };
        const locked = state.clinicProvider;
        const route = routeInvitation(event.type, locked?.row ?? null);
        let result: MailResult;
        let degradedNow = false;
        if (route.kind === "clinic" && locked !== null && deps.clinicMail !== undefined) {
          ({ result, degraded: degradedNow } = await viaClinic(deps.clinicMail, locked, message));
        } else if (route.kind === "platform_on_behalf" && deps.clinicMail !== undefined) {
          // The clinic's name and reply-to, the platform's verified address: never the clinic's domain.
          result = await deps.mail.send({
            ...message,
            from: { name: route.fromName, address: addressOf(deps.clinicMail.platformFrom) },
            replyTo: route.replyTo,
          });
        } else {
          result = await deps.mail.send(message);
        }
        if (!result.sent) {
          return degradedNow ? platformNext(event, result.error) : fail(event, result.error);
        }
        note(event, "sent", {
          provider: result.provider,
          fallback: result.fallback,
          route: route.kind,
        });
        return DONE;
      },
      { clinicProvider: deps.clinicMail !== undefined && event.type === USER_INVITED },
    );
  };
}
