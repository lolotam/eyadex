import type { ClaimedEvent, DispatchOutcome } from "@eyadex/db";
import type { Logger } from "@eyadex/observability";

import { formatExpiry } from "../invitation-mail/domain/invitation-email.ts";
import { afterFailure } from "../invitation-mail/domain/retry-schedule.ts";
import type { MailSender } from "../invitation-mail/ports/mail-sender.ts";
import { daysLeft, parseReminderEvent, reminderSkip } from "./domain/reminder-rules.ts";
import { renderReminderEmail } from "./domain/reminder-email.ts";
import type { ReminderStateReader } from "./ports/reminder-store.ts";

export interface ReminderDispatchDeps {
  readonly state: ReminderStateReader;
  /** بريد المنصة: التنبيه من رسائل الفوترة، والمنصة دايماً هي اللي بتبعتها (قرار المالك 2026-10-07). */
  readonly mail: MailSender;
  readonly clock: { now(): Date };
  readonly logger: Logger;
}

/**
 * بيبعت حدث `clinic.expiry_reminder` لكل أدمن نشط في العيادة، بعد ما يعيد الفحص وقت الإرسال: العيادة
 * اتجدّدت أو اتوقفت أو انتهت → مفيش إيميل. مفتاح الـ idempotency لكل مستلم `<الحدث>:<العضوية>`، فإعادة
 * المحاولة بعد فشل جزئي ماتبعتش لمزود Resend نفس الرسالة مرتين. السطر المسجّل فيه أعداد وأكواد بس.
 */
export function expiryReminderDispatcher(deps: ReminderDispatchDeps) {
  const note = (event: ClaimedEvent, outcome: string, extra: Record<string, unknown> = {}) =>
    deps.logger.info(
      { outbox: { id: event.id, type: event.type, outcome, ...extra } },
      "outbox event handled",
    );
  const failed = (event: ClaimedEvent, error: string): DispatchOutcome => {
    deps.logger.error(
      { outbox: { id: event.id, type: event.type, outcome: "failed", error } },
      "outbox event failed",
    );
    return { kind: "failed", error };
  };
  const retry = (event: ClaimedEvent, error: string): DispatchOutcome => {
    const step = afterFailure(event.attempts, deps.clock.now());
    if (step.kind === "give_up") return failed(event, error);
    note(event, "retry", { error, attempt: event.attempts + 1 });
    return { kind: "retry", error, nextAttemptAt: step.nextAttemptAt };
  };

  return async (event: ClaimedEvent): Promise<DispatchOutcome> => {
    const reminder = parseReminderEvent(event.payload, event.clinicId);
    if (reminder === null) return failed(event, "invalid_payload");
    let state;
    try {
      state = await deps.state.read(reminder.clinicId);
    } catch {
      return retry(event, "db_error");
    }
    // Decision time is after the read: a renewal or a suspension that landed meanwhile wins.
    const now = deps.clock.now();
    const skip = reminderSkip(state, reminder, now);
    if (skip !== null || state === null) {
      note(event, "skipped", { reason: skip ?? "missing" });
      return { kind: "dispatched" };
    }
    const { clinic } = state;
    const expiresOn = formatExpiry(clinic.expiresAt, clinic.language, clinic.timezone);
    for (const recipient of state.recipients) {
      const email = renderReminderEmail({
        language: clinic.language,
        clinicName: clinic.language === "ar" ? clinic.nameAr : clinic.nameEn,
        recipientName: recipient.fullName,
        daysLeft: daysLeft(clinic.expiresAt, now),
        expiresOn,
      });
      const result = await deps.mail.send({
        to: recipient.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
        idempotencyKey: `${event.id}:${recipient.membershipId}`,
      });
      if (!result.sent) return retry(event, result.error);
    }
    note(event, "sent", { count: state.recipients.length });
    return { kind: "dispatched" };
  };
}
