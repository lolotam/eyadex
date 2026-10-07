import type { ClaimedEvent, DispatchOutcome } from "@eyadex/db";
import type { Logger } from "@eyadex/observability";
import type { SecretSealer } from "@eyadex/secrets";

import { formatExpiry, renderInvitationEmail } from "./domain/invitation-email.ts";
import { parseInvitationEvent } from "./domain/invitation-event.ts";
import { afterFailure } from "./domain/retry-schedule.ts";
import { skipReason } from "./domain/send-decision.ts";
import type { InvitationStateReader } from "./ports/invitation-state-reader.ts";
import type { MailSender } from "./ports/mail-sender.ts";

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
    const state = await deps.invitations.read(invitation.clinicId, invitation.invitationId);
    // Decision time is after the read (ADR-0012 §16): an invitation that expired while we waited is skipped.
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
    const result = await deps.mail.send({
      to: invitation.email,
      subject: email.subject.replace(/[\r\n]+/g, " "),
      html: email.html,
      text: email.text,
      idempotencyKey: event.id,
    });
    if (!result.sent) return fail(event, result.error);
    note(event, "sent");
    return DONE;
  };
}
