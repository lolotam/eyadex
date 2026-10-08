import type { ClaimedEvent, DispatchOutcome } from "@eyadex/db";
import type { Logger } from "@eyadex/observability";

import { formatExpiry } from "../invitation-mail/domain/invitation-email.ts";
import { afterFailure } from "../invitation-mail/domain/retry-schedule.ts";
import type { MailSender } from "../invitation-mail/ports/mail-sender.ts";
import { parseReminderEvent, reminderSkip, type ReminderEvent } from "./domain/reminder-rules.ts";
import { renderReminderEmail } from "./domain/reminder-email.ts";
import type { ReminderState, ReminderStateReader } from "./ports/reminder-store.ts";

export interface ReminderDispatchDeps {
  readonly state: ReminderStateReader;
  /** بريد المنصة: التنبيه من رسائل الفوترة، والمنصة دايماً هي اللي بتبعتها (قرار المالك 2026-10-07). */
  readonly mail: MailSender;
  readonly clock: { now(): Date };
  readonly logger: Logger;
}

/**
 * بيبعت حدث `clinic.expiry_reminder` لأدمن واحد (حدث لكل أدمن)، بعد ما يعيد الفحص وقت الإرسال: العيادة
 * اتجدّدت أو اتوقفت أو انتهت، أو المستلم مابقاش أدمن نشط → مفيش إيميل. مفتاح الـ idempotency هو id الحدث
 * والجسم ثابت بين المحاولات. السطر المسجّل فيه أكواد بس، مفيش إيميل ولا اسم.
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

  const handle = async (event: ClaimedEvent): Promise<DispatchOutcome> => {
    const reminder = parseReminderEvent(event.payload, event.clinicId);
    if (reminder === null) return failed(event, "invalid_payload");
    try {
      // The clinic and the recipient stay locked until the send returns: a renewal, a suspension or a
      // demotion waits, so the state checked here is the state the email is about.
      return await deps.state.whileLocked(reminder.clinicId, reminder.membershipId, (state) =>
        send(event, reminder, state),
      );
    } catch {
      return retry(event, "db_error");
    }
  };

  const send = async (
    event: ClaimedEvent,
    reminder: ReminderEvent,
    state: ReminderState | null,
  ): Promise<DispatchOutcome> => {
    // Decision time is after the locks.
    const skip = reminderSkip(state, reminder, deps.clock.now());
    if (skip !== null || state === null || state.recipient === null) {
      note(event, "skipped", { reason: skip ?? "missing" });
      return { kind: "dispatched" };
    }
    const { clinic, recipient } = state;
    // Everything in the body comes from the event or the stored expiry it was checked against, so a
    // retry sends the same message under the same idempotency key.
    const email = renderReminderEmail({
      language: clinic.language,
      clinicName: clinic.language === "ar" ? clinic.nameAr : clinic.nameEn,
      recipientName: recipient.fullName,
      daysLeft: reminder.daysLeft,
      expiresOn: formatExpiry(new Date(reminder.expiresAt), clinic.language, clinic.timezone),
    });
    const result = await deps.mail.send({
      to: recipient.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: event.id,
    });
    if (!result.sent) return retry(event, result.error);
    note(event, "sent", { provider: result.provider, fallback: result.fallback });
    return { kind: "dispatched" };
  };

  return handle;
}
