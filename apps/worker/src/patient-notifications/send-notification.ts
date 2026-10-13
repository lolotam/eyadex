import type { ClaimedEvent, DispatchOutcome } from "@eyadex/db";

import { afterFailure } from "../invitation-mail/domain/retry-schedule.ts";
import { parseNotificationEvent } from "./domain/notification-event.ts";
import { DONE, type HandlerContext, type NotificationDispatchDeps } from "./handler-context.ts";
import type { ReadyNotification } from "./ports/notification-store.ts";
import { sendEmail } from "./send-email.ts";
import { sendWhatsapp } from "./send-whatsapp.ts";

export type { NotificationDispatchDeps } from "./handler-context.ts";

/**
 * بيبعت حدث `patient.notification_requested` واحد (spec §3.3، §7.1): يمسك صف الدفتر ويعيد قراءة كل حاجة
 * وقت الإرسال، وبعدين يسلّم الصف لقناته: الإيميل (مسارات العيادة ثم المنصة) أو واتساب (رقم العيادة، بطابور
 * لكل عيادة). مفيش تحويل من قناة لقناة. السطر المسجّل فيه أكواد بس: مفيش إيميل ولا رقم ولا اسم ولا دوا.
 *
 * @param deps الدفتر والمزودون وواتساب والمفاتيح والساعة ومسجل الأكواد
 * @returns معالج الحدث وقرار إنهائه أو تأجيله أو إعادة محاولته
 */
export function notificationDispatcher(deps: NotificationDispatchDeps) {
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
  // Nothing a retry can fix (a missing visit, no key to open the prescription): the row and the event close.
  const broken = async (event: ClaimedEvent, state: ReadyNotification, error: string) => {
    await state.record({
      kind: "failure",
      error,
      attempts: event.attempts + 1,
      final: true,
      at: deps.clock.now(),
    });
    return failed(event, error);
  };
  const ctx: HandlerContext = { deps, note, failed, broken };

  return async (event: ClaimedEvent): Promise<DispatchOutcome> => {
    const parsed = parseNotificationEvent(event.payload, event.clinicId);
    if (parsed === null) return failed(event, "invalid_payload");
    try {
      return await deps.store.whileLocked(parsed.clinicId, parsed.notificationId, async (state) => {
        if (state.kind === "missing") return failed(event, "missing");
        if (state.kind === "settled") {
          note(event, "skipped", { reason: "settled" });
          return DONE;
        }
        return state.ledger.channel === "whatsapp"
          ? sendWhatsapp(ctx, event, parsed.clinicId, state)
          : sendEmail(ctx, event, parsed.clinicId, state);
      });
    } catch {
      // The transaction rolled back, the ledger row with it: the next attempt reads everything again.
      const step = afterFailure(event.attempts, deps.clock.now());
      if (step.kind === "give_up") return failed(event, "db_error");
      note(event, "retry", { error: "db_error", attempt: event.attempts + 1 });
      return { kind: "retry", error: "db_error", nextAttemptAt: step.nextAttemptAt };
    }
  };
}
