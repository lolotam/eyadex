import type { WhatsappTemplate } from "@eyadex/contracts/whatsapp";
import type { ClaimedEvent, DispatchOutcome } from "@eyadex/db";

import { afterFailure } from "../invitation-mail/domain/retry-schedule.ts";
import { finalWhatsappError } from "./domain/evolution-failure.ts";
import { notificationSkip, type WhatsappFacts } from "./domain/skip-decision.ts";
import { whatsappNumber } from "./domain/whatsapp-address.ts";
import { nextSendAt, PACE_MS, paceWait } from "./domain/whatsapp-pace.ts";
import { whatsappTemplateValues, whatsappText } from "./domain/whatsapp-message.ts";
import { templateFor, templateLanguage } from "./domain/whatsapp-template.ts";
import { DONE, type HandlerContext } from "./handler-context.ts";
import { buildContent } from "./notification-content.ts";
import type { ReadyNotification } from "./ports/notification-store.ts";

/**
 * صف واتساب (spec §7.1): نفس قرارات التخطي بتاعة الإيميل على `whatsappEnabled`، ثم القناة مش متوصلة
 * (`whatsapp_disconnected`) أو قالب ناقص (`template_missing`). الطابور: رسالة واحدة للعيادة في المرة
 * تحت قفل صف القناة، وبين كل رسالتين 8–12 ثانية؛ قبل الدور الحدث بيتأجل من غير ما يتحسب محاولة. الفشل
 * بيعيد بجدول N1، ومفيش تحويل لقناة تانية. الرقم والنص عمرهم ما بيتسجّلوا.
 *
 * @param ctx الاعتماديات وطرق إنهاء الحدث
 * @param event الحدث الممسوك
 * @param clinicId العيادة
 * @param state الصفوف الممسوكة (وصف القناة)
 * @returns نتيجة الحدث
 */
export async function sendWhatsapp(
  ctx: HandlerContext,
  event: ClaimedEvent,
  clinicId: string,
  state: ReadyNotification,
): Promise<DispatchOutcome> {
  const { deps } = ctx;
  const { kind } = state.ledger;
  const subjectMissing =
    kind === "prescription" ? state.visit === null : state.appointment === null;
  if (subjectMissing) return ctx.broken(event, state, "subject_missing");
  const skip = (whatsapp: WhatsappFacts) =>
    notificationSkip({
      kind,
      settings: state.settings,
      patient: { email: state.patient.email, optedOut: state.patient.optedOut },
      appointment: kind === "prescription" ? null : state.appointment,
      whatsapp,
    });
  const skipped = async (reason: NonNullable<ReturnType<typeof skip>>) => {
    await state.record({ kind: "skipped", reason, at: deps.clock.now() });
    ctx.note(event, "skipped", { reason });
    return DONE;
  };
  // What does not depend on the channel first: a message no longer wanted says so, whatever the link.
  const unwanted = skip({ connected: true, templateMissing: false });
  if (unwanted !== null) return skipped(unwanted);
  const channel = state.whatsapp ?? { kind: "none" };
  const sender = deps.whatsapp;
  // Another send of this clinic holds the channel now: wait one pace. Not an attempt.
  if (sender !== null && channel.kind === "busy") {
    return defer(ctx, event, new Date(deps.clock.now().getTime() + PACE_MS));
  }
  const locked = channel.kind === "locked" ? channel : null;
  const template: WhatsappTemplate | null =
    locked?.transport === "coexistence" ? templateFor(locked.templates, kind) : null;
  const reason = skip({
    connected:
      sender !== null &&
      locked !== null &&
      locked.status === "connected" &&
      locked.transport !== null &&
      locked.instanceName !== null,
    templateMissing: locked?.transport === "coexistence" && template === null,
  });
  if (reason !== null) return skipped(reason);
  if (
    sender === null ||
    locked === null ||
    locked.transport === null ||
    locked.instanceName === null
  ) {
    return skipped("whatsapp_disconnected");
  }
  const wait = paceWait(locked.nextSendAt, deps.clock.now());
  if (wait !== null) return defer(ctx, event, wait);
  const number = whatsappNumber(state.patient.phone);
  if (number === null) return ctx.broken(event, state, "invalid_phone");
  const patientLanguage = state.patient.language ?? state.clinic.language;
  const language =
    template === null ? patientLanguage : templateLanguage(template, patientLanguage);
  const content = buildContent(state, clinicId, deps.cipher, language);
  if (content.kind === "broken") return ctx.broken(event, state, content.error);
  const { transport, instanceName } = locked;
  const result =
    template === null
      ? await sender.sendText(instanceName, number, whatsappText(content))
      : await sender.sendTemplate(instanceName, number, {
          name: template.name,
          language: template.language,
          parameters: whatsappTemplateValues(content),
        });
  const at = deps.clock.now();
  await locked.recordSend(
    nextSendAt(at, deps.random ?? Math.random),
    result.sent ? null : result.error,
    at,
  );
  if (result.sent) {
    await state.record({ kind: "sent", route: transport, at });
    if (kind === "prescription") await state.auditPrescriptionSent(at);
    ctx.note(event, "sent", { route: transport });
    return DONE;
  }
  const error = `${transport}:${result.error}`;
  const step = afterFailure(event.attempts, at);
  const nextAttemptAt =
    step.kind === "retry" && !finalWhatsappError(result.error) ? step.nextAttemptAt : null;
  await state.record({
    kind: "failure",
    error,
    attempts: event.attempts + 1,
    final: nextAttemptAt === null,
    at,
  });
  if (nextAttemptAt === null) return ctx.failed(event, error);
  ctx.note(event, "retry", { error, attempt: event.attempts + 1 });
  return { kind: "retry", error, nextAttemptAt };
}

function defer(ctx: HandlerContext, event: ClaimedEvent, until: Date): DispatchOutcome {
  ctx.note(event, "deferred", { until: until.toISOString() });
  return { kind: "deferred", nextAttemptAt: until };
}
