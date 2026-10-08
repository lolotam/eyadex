import type { ClaimedEvent, DispatchOutcome } from "@eyadex/db";
import type { Logger } from "@eyadex/observability";
import type { SecretSealer } from "@eyadex/secrets";

import { afterFailure } from "../invitation-mail/domain/retry-schedule.ts";
import type { MailSender } from "../invitation-mail/ports/mail-sender.ts";
import { parseTeamInvite, renderTeamInvite, teamInviteSkip } from "./domain/team-invite.ts";
import type { TeamInviteStateReader } from "./pg-team-invite-state.ts";

export interface TeamInviteDeps {
  readonly sealer: SecretSealer;
  readonly accounts: TeamInviteStateReader;
  /** بريد المنصة دايماً لحسابات المنصة (قرار المالك 2026-10-07). */
  readonly mail: MailSender;
  readonly clock: { now(): Date };
  /** origin منطقة المنصة، من غير `/` في الآخر: الرابط `${platformUrl}/invite/<token>`. */
  readonly platformUrl: string;
  readonly logger: Logger;
}

/**
 * بيبعت دعوة فريق المنصة (ADR-0020) بنفس قواعد ADR-0013: يفتح الرمز بـ id الحدث، يمسك صف الحساب، يبعت
 * لو الرابط لسه صالح ومطابق، وبعد النتيجة الختم بيتمسح من الحمولة (الـ dispatcher). مفيش رمز ولا رابط
 * ولا إيميل في أي سطر لوج.
 */
export function teamInviteDispatcher(deps: TeamInviteDeps) {
  const failed = (event: ClaimedEvent, error: string): DispatchOutcome => {
    deps.logger.error(
      { outbox: { id: event.id, type: event.type, outcome: "failed", error } },
      "outbox event failed",
    );
    return { kind: "failed", error };
  };
  const note = (event: ClaimedEvent, outcome: string, extra: Record<string, unknown> = {}) =>
    deps.logger.info(
      { outbox: { id: event.id, type: event.type, outcome, ...extra } },
      "outbox event handled",
    );

  return async (event: ClaimedEvent): Promise<DispatchOutcome> => {
    const invite = parseTeamInvite(event.payload, event.clinicId);
    if (invite === null) return failed(event, "invalid_payload");
    let token: string;
    try {
      token = deps.sealer.open(invite.sealedToken, event.id);
    } catch {
      return failed(event, "seal_unreadable");
    }
    return deps.accounts.whileLocked(invite.accountId, async (state) => {
      const reason = teamInviteSkip(state, token, deps.clock.now());
      if (reason !== null) {
        note(event, "skipped", { reason });
        return { kind: "dispatched" };
      }
      const link = `${deps.platformUrl}/invite/${encodeURIComponent(token)}`;
      const email = renderTeamInvite(invite, link);
      const result = await deps.mail.send({
        to: invite.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
        idempotencyKey: event.id,
      });
      if (!result.sent) {
        const step = afterFailure(event.attempts, deps.clock.now());
        if (step.kind === "give_up") return failed(event, result.error);
        note(event, "retry", { error: result.error, attempt: event.attempts + 1 });
        return { kind: "retry", error: result.error, nextAttemptAt: step.nextAttemptAt };
      }
      note(event, "sent", { provider: result.provider, fallback: result.fallback });
      return { kind: "dispatched" };
    });
  };
}
