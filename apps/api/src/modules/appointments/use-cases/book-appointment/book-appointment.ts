import {
  isAppointmentLength,
  isReschedulable,
  resolveAppointmentEnd,
  type AppointmentInput,
  type AppointmentRescheduleInput,
  type AppointmentWriteResponse,
} from "@eyadex/contracts/appointments";
import type { Tx } from "@eyadex/db";

import {
  claimClinicIdempotencyKey,
  completeClinicIdempotencyKey,
} from "../../../../shared/clinic-idempotency.ts";
import { ApiError } from "../../../../shared/errors.ts";
import { requestHash } from "../../../../shared/idempotency.ts";
import { lockProvider } from "../../../../shared/provider-lock.ts";
import { actorReach, decideSlot, type AppointmentActor } from "../../domain/booking-rules.ts";
import { reachCovers } from "../../domain/scheduling-scope.ts";
import {
  insertAppointment,
  saveTimes,
  type AppointmentRow,
} from "../../persistence/pg-appointment-store.ts";
import { appointmentAnswer } from "../../queries/appointment-views.ts";
import {
  auditFieldsOf,
  lockExisting,
  lockTarget,
  slotProblems,
  writeAppointmentAudit,
  type AppointmentDeps,
} from "../appointment-locks.ts";

type StoredCreate = { id: string };

const lengthError = () => new ApiError("validation", [{ path: ["endsAt"], code: "custom" }]);

/**
 * الحجز وتغيير الموعد (spec §4 قواعد 1–4، 6–9؛ D-3، D-6، D-13، D-14، D-15). كل عملية transaction واحدة
 * تحت قفل مقدّم الخدمة، والصفوف بتتقفل بترتيب ADR-0027 قبل أي فحص، فحجزين لنفس مقدّم الخدمة في نفس
 * اللحظة واحد بس فيهم بيعدّي. الحجز الإضافي بيشيل فحوص قاعدة 2 التلاتة بس.
 */
export class BookAppointment {
  constructor(private readonly deps: AppointmentDeps) {}

  /**
   * يحجز موعد بمفتاح `Idempotency-Key` إلزامي (قاعدة 8). الإعادة بنفس المفتاح والجسم = نفس الموعد.
   *
   * @param actor الفاعل
   * @param input الجسم بعد `appointmentInputSchema`
   * @param idempotencyKey المفتاح
   * @returns الموعد زي ما مفاتيح العرض بتشوفه
   */
  create(
    actor: AppointmentActor,
    input: AppointmentInput,
    idempotencyKey: string,
  ): Promise<AppointmentWriteResponse> {
    this.assertMay(actor, "create", input.branchId, input.overbook);
    const { db, clock, ids } = this.deps;
    const claim = {
      clinicId: actor.clinicId,
      scope: `appointments:create:${actor.userId}`,
      key: idempotencyKey,
      hash: requestHash(input),
    };
    return db.withTenant(actor.clinicId, async (tx) => {
      const claimed = await claimClinicIdempotencyKey<StoredCreate>(
        tx,
        claim,
        ids.newId(),
        clock.now(),
      );
      if (claimed.kind === "conflict") throw new ApiError("idempotency_conflict");
      if (claimed.kind === "replay") return this.answer(tx, actor, claimed.response.id);
      await lockProvider(tx, actor.clinicId, input.providerMembershipId);
      const { provider, service } = await lockTarget(tx, this.deps, actor.clinicId, {
        providerId: input.providerMembershipId,
        branchId: input.branchId,
        patientId: input.patientId,
        serviceId: input.serviceId,
      });
      const endsAt = resolveAppointmentEnd(
        input.startsAt,
        input.endsAt,
        service?.durationMinutes ?? null,
        provider.defaultDurationMinutes,
      );
      const startsAt = new Date(input.startsAt).toISOString();
      if (!isAppointmentLength(startsAt, endsAt)) throw lengthError();
      const target = { providerId: provider.membershipId, branchId: input.branchId };
      const problems = await slotProblems(tx, actor, target, { startsAt, endsAt }, null);
      const decision = decideSlot(problems, input.overbook);
      if (decision.kind === "refused") throw new ApiError(decision.code);
      const row: AppointmentRow = {
        id: ids.newId(),
        branchId: input.branchId,
        patientId: input.patientId,
        providerMembershipId: provider.membershipId,
        serviceId: service?.id ?? null,
        startsAt,
        endsAt,
        status: "booked",
        overbooked: decision.overbooked,
        cancelReason: null,
        cancelNote: null,
      };
      await insertAppointment(tx, actor.clinicId, row, actor.userId, clock.now());
      await writeAppointmentAudit(tx, this.deps, actor, "appointment.booked", row.id, {
        before: null,
        after: await auditFieldsOf(tx, this.deps, actor.clinicId, row),
      });
      await completeClinicIdempotencyKey(tx, claim, { id: row.id } satisfies StoredCreate);
      return this.answer(tx, actor, row.id);
    });
  }

  /**
   * يغيّر وقت موعد محجوز (وممكن مقدّم الخدمة أو الفرع) بنفس فحوص الحجز (قاعدة 6). نفس القيم = نفس الرد
   * من غير صف سجل.
   *
   * @param actor الفاعل
   * @param id الموعد
   * @param input الجسم بعد `appointmentRescheduleSchema`
   * @returns الموعد بعد التغيير زي ما مفاتيح العرض بتشوفه
   */
  reschedule(
    actor: AppointmentActor,
    id: string,
    input: AppointmentRescheduleInput,
  ): Promise<AppointmentWriteResponse> {
    this.assertMay(actor, "update", input.branchId, input.overbook);
    const { db, clock } = this.deps;
    return db.withTenant(actor.clinicId, async (tx) => {
      const before = await lockExisting(tx, actor.clinicId, id, actorReach(actor, "update"), [
        input.providerMembershipId,
      ]);
      if (!isReschedulable(before.status)) throw new ApiError("invalid_transition");
      const startsAt = new Date(input.startsAt).toISOString();
      const endsAt = new Date(input.endsAt).toISOString();
      const same =
        before.branchId === input.branchId &&
        before.providerMembershipId === input.providerMembershipId &&
        before.startsAt === startsAt &&
        before.endsAt === endsAt;
      if (same) return this.answer(tx, actor, id);
      const { provider } = await lockTarget(tx, this.deps, actor.clinicId, {
        providerId: input.providerMembershipId,
        branchId: input.branchId,
        patientId: null,
        serviceId: null,
      });
      const target = { providerId: provider.membershipId, branchId: input.branchId };
      const problems = await slotProblems(tx, actor, target, { startsAt, endsAt }, id);
      const decision = decideSlot(problems, input.overbook);
      if (decision.kind === "refused") throw new ApiError(decision.code);
      const after: AppointmentRow = {
        ...before,
        branchId: input.branchId,
        providerMembershipId: provider.membershipId,
        startsAt,
        endsAt,
        overbooked: decision.overbooked,
      };
      const beforeFields = await auditFieldsOf(tx, this.deps, actor.clinicId, before);
      await saveTimes(tx, actor.clinicId, after, clock.now());
      await writeAppointmentAudit(tx, this.deps, actor, "appointment.rescheduled", id, {
        before: beforeFields,
        after: await auditFieldsOf(tx, this.deps, actor.clinicId, after),
      });
      return this.answer(tx, actor, id);
    });
  }

  // The branch inside the action's reach (rule 2's first check), and the overbook key there when asked:
  // both read the caller's keys only, so they are decided before any lock.
  private assertMay(
    actor: AppointmentActor,
    action: "create" | "update",
    branchId: string,
    overbook: boolean,
  ): void {
    if (!reachCovers(actorReach(actor, action), branchId)) throw new ApiError("forbidden");
    if (overbook && !reachCovers(actorReach(actor, "overbook"), branchId)) {
      throw new ApiError("forbidden");
    }
  }

  private answer(tx: Tx, actor: AppointmentActor, id: string): Promise<AppointmentWriteResponse> {
    const { providers, patients } = this.deps;
    return appointmentAnswer({ tx, providers, patients }, actor, id);
  }
}
