import type { WhatsappTemplate } from "@eyadex/contracts/whatsapp";
import type { ClaimedEvent, DispatchOutcome } from "@eyadex/db";

import { notificationSkip, type WhatsappFacts } from "./domain/skip-decision.ts";
import { paceWait, PACE_MS } from "./domain/whatsapp-pace.ts";
import { templateFor } from "./domain/whatsapp-template.ts";
import { DONE, type HandlerContext } from "./handler-context.ts";
import { sendFacts, subjectMissing } from "./notification-content.ts";
import type { LockedWhatsappChannel, ReadyNotification } from "./ports/notification-store.ts";

type Readiness =
  | { readonly kind: "stop"; readonly outcome: DispatchOutcome }
  | {
      readonly kind: "ready";
      readonly channel: LockedWhatsappChannel | null;
      readonly template: WhatsappTemplate | null;
    };

/**
 * بيحسم التخطي قبل إنشاء رابط الفاتورة، ويتراجع تاني تحت قفل الإرسال لو الحالة اتغيرت بين الخطوتين.
 *
 * @param ctx الاعتماديات وطرق إنهاء الحدث
 * @param event الحدث الممسوك
 * @param state صفوف الرسالة الممسوكة
 * @returns سبب التوقف أو قناة الإرسال الجاهزة
 */
export async function sendReadiness(
  ctx: HandlerContext,
  event: ClaimedEvent,
  state: ReadyNotification,
): Promise<Readiness> {
  if (subjectMissing(state)) {
    return { kind: "stop", outcome: await ctx.broken(event, state, "subject_missing") };
  }
  const skip = (whatsapp?: WhatsappFacts) =>
    notificationSkip({ ...sendFacts(state), ...(whatsapp === undefined ? {} : { whatsapp }) });
  const skipped = async (reason: NonNullable<ReturnType<typeof skip>>): Promise<Readiness> => {
    await state.record({ kind: "skipped", reason, at: ctx.deps.clock.now() });
    ctx.note(event, "skipped", { reason });
    return { kind: "stop", outcome: DONE };
  };
  if (state.ledger.channel === "email") {
    const reason = skip();
    return reason === null ? { kind: "ready", channel: null, template: null } : skipped(reason);
  }
  const unwanted = skip({ connected: true, templateMissing: false });
  if (unwanted !== null) return skipped(unwanted);
  const channel = state.whatsapp ?? { kind: "none" };
  const defer = (until: Date): Readiness => {
    ctx.note(event, "deferred", { until: until.toISOString() });
    return { kind: "stop", outcome: { kind: "deferred", nextAttemptAt: until } };
  };
  if (channel.kind === "busy") {
    return defer(new Date(ctx.deps.clock.now().getTime() + PACE_MS));
  }
  const locked = channel.kind === "locked" ? channel : null;
  const template =
    locked?.transport === "coexistence" ? templateFor(locked.templates, state.ledger.kind) : null;
  const reason = skip({
    connected:
      locked !== null &&
      locked.status === "connected" &&
      locked.transport !== null &&
      (locked.transport === "evolution"
        ? ctx.deps.whatsapp !== null && locked.instanceName !== null
        : ctx.deps.meta !== undefined &&
          ctx.deps.whatsappSealer !== undefined &&
          locked.sealedCredentials !== null &&
          locked.phoneNumberId !== null),
    templateMissing: locked?.transport === "coexistence" && template === null,
  });
  if (reason !== null) return skipped(reason);
  if (locked === null || locked.transport === null) return skipped("whatsapp_disconnected");
  const wait = paceWait(locked.nextSendAt, ctx.deps.clock.now());
  return wait === null ? { kind: "ready", channel: locked, template } : defer(wait);
}
