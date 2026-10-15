import type { ClaimedEvent, DispatchOutcome } from "@eyadex/db";

import { afterFailure } from "../invitation-mail/domain/retry-schedule.ts";
import { renderAppointmentEmail } from "./domain/appointment-email.ts";
import { renderInvoiceEmail } from "./domain/invoice-email.ts";
import { renderPrescriptionEmail } from "./domain/prescription-email.ts";
import {
  certainlyNotAccepted,
  failureCode,
  resumeProvider,
  resumeRoute,
} from "./domain/route-advance.ts";
import { onBehalfReplyTo, planRoutes } from "./domain/route-plan.ts";
import { notificationSkip } from "./domain/skip-decision.ts";
import { DONE, type HandlerContext, type SendTarget } from "./handler-context.ts";
import { buildContent, sendFacts, subjectMissing } from "./notification-content.ts";
import type { ReadyNotification } from "./ports/notification-store.ts";
import { sendAlongRoutes } from "./send-along-routes.ts";

/**
 * صف إيميل (spec §3.3): يتخطّى بسبب مكتوب لو الرسالة مابقتش مطلوبة، وإلا يبني الإيميل بلغة المراجع ويبعته
 * على مسارات العيادة ثم المنصة، ويكمّل من المسار المثبّت بعد فشل غامض.
 *
 * @param ctx الاعتماديات وطرق إنهاء الحدث
 * @param event الحدث الممسوك
 * @param target العيادة ورابط الفاتورة
 * @param state الصفوف الممسوكة
 * @returns نتيجة الحدث
 */
export async function sendEmail(
  ctx: HandlerContext,
  event: ClaimedEvent,
  target: SendTarget,
  state: ReadyNotification,
): Promise<DispatchOutcome> {
  const { deps } = ctx;
  const { kind } = state.ledger;
  if (subjectMissing(state)) return ctx.broken(event, state, "subject_missing");
  const reason = notificationSkip(sendFacts(state));
  if (reason !== null || state.patient.email === null) {
    await state.record({ kind: "skipped", reason: reason ?? "no_email", at: deps.clock.now() });
    ctx.note(event, "skipped", { reason: reason ?? "no_email" });
    return DONE;
  }
  const language = state.patient.language ?? state.clinic.language;
  const content = buildContent(state, target, deps.cipher, language);
  if (content.kind === "broken") return ctx.broken(event, state, content.error);
  const email =
    content.kind === "appointment"
      ? renderAppointmentEmail(content.message)
      : content.kind === "prescription"
        ? renderPrescriptionEmail(content.message)
        : renderInvoiceEmail(content.message);
  const { primary, fallback } = state.providers;
  const resume = resumeRoute(state.ledger.lastError);
  const plan = planRoutes(primary?.row ?? null, fallback?.row ?? null, resume);
  if (resume !== null && resume !== "platform") {
    const pin = resumeProvider(state.ledger.lastError);
    if (pin === null) return ctx.broken(event, state, "ambiguous_provider_unknown");
    const row = state.providers[resume]?.row;
    if (plan.length === 0 || row?.id !== pin.id || row.version !== pin.version)
      return ctx.broken(event, state, "ambiguous_provider_unavailable");
  }
  const chain = await sendAlongRoutes(
    {
      clinicMail: deps.clinicMail,
      platform: deps.platform,
      now: () => deps.clock.now(),
      ...(deps.budgetMs === undefined ? {} : { budgetMs: deps.budgetMs }),
    },
    plan,
    state.providers,
    { to: state.patient.email, ...email, idempotencyKey: event.id },
    {
      fromName: language === "ar" ? state.clinic.nameAr : state.clinic.nameEn,
      replyTo: onBehalfReplyTo(primary?.row ?? null, fallback?.row ?? null),
    },
  );
  const at = deps.clock.now();
  if (chain.sent) {
    await state.record({ kind: "sent", route: chain.route, at });
    if (kind === "prescription") await state.auditPrescriptionSent(at);
    ctx.note(event, "sent", { route: chain.route });
    return DONE;
  }
  const provider = chain.route === "platform" ? undefined : state.providers[chain.route]?.row;
  // A refusal on a retry cannot prove that the earlier ambiguous attempt was never accepted.
  const error =
    resume !== null && state.ledger.lastError !== null
      ? state.ledger.lastError
      : failureCode(
          chain.route,
          chain.error,
          certainlyNotAccepted(chain.error) ? undefined : provider,
        );
  const step = afterFailure(event.attempts, at);
  // Only an unpinned chain may use a degradation to try another route past the retry limit.
  const nextAttemptAt =
    step.kind === "retry" ? step.nextAttemptAt : chain.degraded && resume === null ? at : null;
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
