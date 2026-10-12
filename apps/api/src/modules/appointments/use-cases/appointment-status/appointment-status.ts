import type {
  AppointmentCancel,
  AppointmentStatus,
  AppointmentStatusInput,
  AppointmentWriteResponse,
  CancelReason,
} from "@eyadex/contracts/appointments";

import { ApiError } from "../../../../shared/errors.ts";
import { appointmentNotice } from "../../domain/appointment-notices.ts";
import { actorReach, decideTransition, type AppointmentActor } from "../../domain/booking-rules.ts";
import { saveStatus, type AppointmentRow } from "../../persistence/pg-appointment-store.ts";
import { appointmentAnswer } from "../../queries/appointment-views.ts";
import {
  auditFieldsOf,
  lockExisting,
  retryWhenMoved,
  writeAppointmentAudit,
  type AppointmentDeps,
} from "../appointment-locks.ts";

/**
 * حالات الموعد والإلغاء (D-5، D-11، قاعدة 5): transaction واحدة تحت قفل مقدّم الخدمة ثم صف الموعد، فيها
 * صف سجل واحد. نفس الحالة = نفس الرد من غير صف سجل؛ أي نقلة برّه الجدول = `invalid_transition`.
 */
export class AppointmentStatusChanges {
  constructor(private readonly deps: AppointmentDeps) {}

  /**
   * حضر / اكتمل / لم يحضر.
   *
   * @param actor الفاعل بوصول `update:appointments`
   * @param id الموعد
   * @param input الحالة بعد `appointmentStatusInputSchema`
   * @returns الموعد بعد التغيير زي ما مفاتيح العرض بتشوفه
   */
  setStatus(
    actor: AppointmentActor,
    id: string,
    input: AppointmentStatusInput,
  ): Promise<AppointmentWriteResponse> {
    return this.move(actor, id, input.status, null, null, "appointment.status_changed");
  }

  /**
   * يلغي موعد محجوز أو حاضر بسبب من القايمة وملاحظة اختيارية (الملاحظة عمرها ما بتتسجّل في السجل).
   *
   * @param actor الفاعل بوصول `update:appointments`
   * @param id الموعد
   * @param input السبب والملاحظة بعد `appointmentCancelSchema`
   * @returns الموعد بعد الإلغاء زي ما مفاتيح العرض بتشوفه
   */
  cancel(
    actor: AppointmentActor,
    id: string,
    input: AppointmentCancel,
  ): Promise<AppointmentWriteResponse> {
    const note = input.note === null || input.note === "" ? null : input.note;
    return this.move(actor, id, "cancelled", input.reason, note, "appointment.cancelled");
  }

  private move(
    actor: AppointmentActor,
    id: string,
    to: AppointmentStatus,
    cancelReason: CancelReason | null,
    cancelNote: string | null,
    action: string,
  ): Promise<AppointmentWriteResponse> {
    const { db, clock, providers, patients, notifications } = this.deps;
    return retryWhenMoved(() =>
      db.withTenant(actor.clinicId, async (tx) => {
        const before = await lockExisting(tx, actor.clinicId, id, actorReach(actor, "update"));
        const decision = decideTransition(before.status, to);
        if (decision === "invalid") throw new ApiError("invalid_transition");
        if (decision === "move") {
          const after: AppointmentRow = { ...before, status: to, cancelReason, cancelNote };
          const beforeFields = await auditFieldsOf(tx, this.deps, actor.clinicId, before);
          await saveStatus(tx, actor.clinicId, id, after, clock.now());
          await writeAppointmentAudit(tx, this.deps, actor, action, id, {
            before: beforeFields,
            after: { ...beforeFields, status: to, cancelReason },
          });
          // A cancellation names the start the appointment had (it does not move); after every lock,
          // so the ledger row's patient key-share lock comes after the appointment row (ADR-0027).
          if (to === "cancelled") {
            await notifications.queue(tx, appointmentNotice("cancelled", before, actor));
          }
        }
        return appointmentAnswer({ tx, providers, patients }, actor, id);
      }),
    );
  }
}
