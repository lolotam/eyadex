import type { ClaimedEvent, DispatchOutcome } from "@eyadex/db";
import type { Logger } from "@eyadex/observability";

import { afterFailure } from "../invitation-mail/domain/retry-schedule.ts";
import type { MailSender } from "../invitation-mail/ports/mail-sender.ts";
import type { ClinicMailDeps } from "../invitation-mail/send-via-clinic.ts";
import { renderAppointmentEmail } from "./domain/appointment-email.ts";
import type { RenderedNotification } from "./domain/email-layout.ts";
import { parseNotificationEvent } from "./domain/notification-event.ts";
import { renderPrescriptionEmail } from "./domain/prescription-email.ts";
import { failureCode, resumeRoute } from "./domain/route-advance.ts";
import { onBehalfReplyTo, planRoutes } from "./domain/route-plan.ts";
import { notificationSkip } from "./domain/skip-decision.ts";
import type { NotificationStore, ReadyNotification } from "./ports/notification-store.ts";
import { openPrescriptionLines, type FieldOpener } from "./prescription-lines.ts";
import { sendAlongRoutes } from "./send-along-routes.ts";

export interface NotificationDispatchDeps {
  readonly store: NotificationStore;
  /** مزودي العيادة: الختم والمصنع وعنوان المنصة للإرسال بالنيابة. */
  readonly clinicMail: ClinicMailDeps;
  /** بريد المنصة (main.ts): آخر مسار، بالنيابة عن العيادة (N-3). */
  readonly platform: MailSender;
  /** فاتح سطور الوصفة (ADR-0028)؛ `null` لو مفاتيح `MEDICAL_MASTER_KEY_V<n>` مش مضبوطة في الـ worker. */
  readonly cipher: FieldOpener | null;
  readonly clock: { now(): Date };
  readonly logger: Logger;
  /** ميزانية سلسلة المسارات؛ الافتراضي `CHAIN_BUDGET_MS`. */
  readonly budgetMs?: number;
}

const DONE: DispatchOutcome = { kind: "dispatched" };

type Built = { kind: "email"; email: RenderedNotification } | { kind: "broken"; error: string };

/**
 * بيبعت حدث `patient.notification_requested` واحد (spec §3.3): يمسك صف الدفتر ويعيد قراءة كل حاجة وقت
 * الإرسال، يتخطّى بسبب مكتوب لو الرسالة مابقتش مطلوبة، وإلا يبني الإيميل بلغة المراجع ويبعته على مسارات
 * العيادة ثم المنصة. السطر المسجّل فيه أكواد بس: مفيش إيميل ولا اسم ولا دوا.
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

  const build = (state: ReadyNotification, clinicId: string): Built => {
    const language = state.patient.language ?? state.clinic.language;
    const clinicName = language === "ar" ? state.clinic.nameAr : state.clinic.nameEn;
    const { kind } = state.ledger;
    if (kind !== "prescription") {
      const appointment = state.appointment;
      if (appointment === null) return { kind: "broken", error: "subject_missing" };
      const branch = appointment.branch;
      return {
        kind: "email",
        email: renderAppointmentEmail({
          kind,
          language,
          clinicName,
          branchName: language === "ar" ? branch.nameAr : branch.nameEn,
          branchAddress: branch.address,
          startsAt: appointment.startsAt,
          timeZone: state.clinic.timeZone,
          providerName: appointment.providerName,
        }),
      };
    }
    const visit = state.visit;
    if (visit === null || visit.lines.length === 0)
      return { kind: "broken", error: "subject_missing" };
    if (deps.cipher === null) return { kind: "broken", error: "no_medical_key" };
    let lines;
    try {
      lines = openPrescriptionLines(deps.cipher, clinicId, visit.lines);
    } catch {
      return { kind: "broken", error: "field_unreadable" };
    }
    return {
      kind: "email",
      email: renderPrescriptionEmail({ language, clinicName, doctorName: visit.doctorName, lines }),
    };
  };

  const send = async (
    event: ClaimedEvent,
    clinicId: string,
    state: ReadyNotification,
  ): Promise<DispatchOutcome> => {
    const { kind } = state.ledger;
    const subjectMissing =
      kind === "prescription" ? state.visit === null : state.appointment === null;
    if (subjectMissing) return broken(event, state, "subject_missing");
    const reason = notificationSkip({
      kind,
      settings: state.settings,
      patient: { email: state.patient.email, optedOut: state.patient.optedOut },
      appointment: kind === "prescription" ? null : state.appointment,
    });
    if (reason !== null || state.patient.email === null) {
      await state.record({ kind: "skipped", reason: reason ?? "no_email", at: deps.clock.now() });
      note(event, "skipped", { reason: reason ?? "no_email" });
      return DONE;
    }
    const built = build(state, clinicId);
    if (built.kind === "broken") return broken(event, state, built.error);
    const { primary, fallback } = state.providers;
    const language = state.patient.language ?? state.clinic.language;
    const chain = await sendAlongRoutes(
      {
        clinicMail: deps.clinicMail,
        platform: deps.platform,
        now: () => deps.clock.now(),
        ...(deps.budgetMs === undefined ? {} : { budgetMs: deps.budgetMs }),
      },
      planRoutes(primary?.row ?? null, fallback?.row ?? null, resumeRoute(state.ledger.lastError)),
      state.providers,
      { to: state.patient.email, ...built.email, idempotencyKey: event.id },
      {
        fromName: language === "ar" ? state.clinic.nameAr : state.clinic.nameEn,
        replyTo: onBehalfReplyTo(primary?.row ?? null, fallback?.row ?? null),
      },
    );
    const at = deps.clock.now();
    if (chain.sent) {
      await state.record({ kind: "sent", route: chain.route, at });
      if (kind === "prescription") await state.auditPrescriptionSent(at);
      note(event, "sent", { route: chain.route });
      return DONE;
    }
    const error = failureCode(chain.route, chain.error);
    const step = afterFailure(event.attempts, at);
    // This attempt degraded a provider, so the next one skips it: kept even when the schedule would give
    // up now, like the invitation path (ADR-0014, 7c-2b).
    const nextAttemptAt = step.kind === "retry" ? step.nextAttemptAt : chain.degraded ? at : null;
    await state.record({
      kind: "failure",
      error,
      attempts: event.attempts + 1,
      final: nextAttemptAt === null,
      at,
    });
    if (nextAttemptAt === null) return failed(event, error);
    note(event, "retry", { error, attempt: event.attempts + 1 });
    return { kind: "retry", error, nextAttemptAt };
  };

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
        return send(event, parsed.clinicId, state);
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
