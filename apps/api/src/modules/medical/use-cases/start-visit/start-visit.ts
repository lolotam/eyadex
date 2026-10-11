import type { VisitDetail, VisitStartInput } from "@eyadex/contracts/visits";
import { DatabaseError, type Tx } from "@eyadex/db";

import {
  claimClinicIdempotencyKey,
  completeClinicIdempotencyKey,
} from "../../../../shared/clinic-idempotency.ts";
import { ApiError } from "../../../../shared/errors.ts";
import { requestHash } from "../../../../shared/idempotency.ts";
import { lockProvider } from "../../../../shared/provider-lock.ts";
import {
  startFromAppointmentProblem,
  walkInReaches,
  worksIn,
  type MedicalActor,
  type MemberBranches,
} from "../../domain/visit-rules.ts";
import {
  findVisit,
  insertVisit,
  liveVisitOf,
  type NewVisit,
} from "../../persistence/pg-visit-store.ts";
import type { MedicalPatient } from "../../ports/medical-patient-reader.ts";
import { visitDetail } from "../../queries/visit-views.ts";
import { auditMedical, type MedicalDeps } from "../medical-deps.ts";
import { readContext } from "../visit-access.ts";

type StoredStart = { id: string };
/** `visitWriteResponseSchema`: every visit write answers the page as the caller sees it. */
export type VisitWriteResponse = { visit: VisitDetail };

const visitExists = (visitId: string) => new ApiError("visit_exists", { visitId });

/**
 * بداية زيارة (P2-2): من موعد المراجع وصل فيه والفاعل مقدّم خدمته، أو زيارة مباشرة في فرع الفاعل شغّال
 * فيه. transaction واحدة تحت قفل مقدّم الخدمة (الفاعل)، والصفوف بتتقفل بترتيب ADR-0027 قبل أي فحص، فبدايتين
 * لنفس الموعد في نفس اللحظة واحدة بس فيهم بتعدّي والتانية بترد `visit_exists`.
 */
export class StartVisit {
  constructor(private readonly deps: MedicalDeps) {}

  /**
   * يبدأ زيارة بمفتاح `Idempotency-Key` إلزامي: الإعادة بنفس المفتاح والجسم = نفس الزيارة (المخزّن معرّفها
   * بس).
   *
   * @param actor الفاعل (لازم شايل `create:visits:own`)
   * @param input الجسم بعد `visitStartSchema`
   * @param idempotencyKey المفتاح
   * @returns الزيارة زي ما صفحتها بتعرضها للفاعل
   */
  async start(
    actor: MedicalActor,
    input: VisitStartInput,
    idempotencyKey: string,
  ): Promise<VisitWriteResponse> {
    if (!actor.permissions.includes("create:visits:own")) throw new ApiError("forbidden");
    const { db, clock, ids } = this.deps;
    const claim = {
      clinicId: actor.clinicId,
      scope: `visits:start:${actor.userId}`,
      key: idempotencyKey,
      hash: requestHash(input),
    };
    try {
      return await db.withTenant(actor.clinicId, async (tx) => {
        const claimed = await claimClinicIdempotencyKey<StoredStart>(
          tx,
          claim,
          ids.newId(),
          clock.now(),
        );
        if (claimed.kind === "conflict") throw new ApiError("idempotency_conflict");
        if (claimed.kind === "replay") return this.answer(tx, actor, claimed.response.id);
        const target =
          "appointmentId" in input
            ? await this.fromAppointment(tx, actor, input.appointmentId)
            : await this.walkIn(tx, actor, input.patientId, input.branchId);
        const visit: NewVisit = { id: ids.newId(), ...target };
        await insertVisit(tx, actor.clinicId, visit, clock.now());
        await auditMedical(tx, this.deps, actor, {
          action: "visit.started",
          entityType: "visit",
          entityId: visit.id,
          branchId: visit.branchId,
          changed: ["status"],
        });
        await completeClinicIdempotencyKey(tx, claim, { id: visit.id } satisfies StoredStart);
        return this.answer(tx, actor, visit.id);
      });
    } catch (error) {
      // The live-visit index is the backstop for a start that skipped the provider lock (none does).
      if (!(error instanceof DatabaseError && error.code === "23505")) throw error;
      if (!("appointmentId" in input)) throw error;
      const existing = await db.withTenant(actor.clinicId, (tx) =>
        liveVisitOf(tx, actor.clinicId, input.appointmentId),
      );
      throw existing === null ? error : visitExists(existing);
    }
  }

  private async fromAppointment(
    tx: Tx,
    actor: MedicalActor,
    appointmentId: string,
  ): Promise<Omit<NewVisit, "id">> {
    const { clinicId, membershipId } = actor;
    const seen = await this.deps.appointments.find(tx, clinicId, appointmentId);
    if (seen === null) throw new ApiError("not_found");
    // Another provider's appointment is refused before any lock: its provider never becomes the caller.
    if (seen.providerMembershipId !== membershipId) throw new ApiError("forbidden");
    await lockProvider(tx, clinicId, membershipId);
    const appointment = await this.deps.appointments.lockForVisit(tx, clinicId, appointmentId);
    if (appointment === null) throw new ApiError("not_found");
    const problem = startFromAppointmentProblem(appointment, membershipId);
    if (problem !== null) throw new ApiError(problem);
    const live = await liveVisitOf(tx, clinicId, appointmentId);
    if (live !== null) throw visitExists(live);
    // The appointment already placed the visit: its branch stands even if the member's branches moved.
    await this.lockRows(tx, actor, appointment, () => true);
    return {
      branchId: appointment.branchId,
      patientId: appointment.patientId,
      providerMembershipId: membershipId,
      appointmentId,
    };
  }

  private async walkIn(
    tx: Tx,
    actor: MedicalActor,
    patientId: string,
    branchId: string,
  ): Promise<Omit<NewVisit, "id">> {
    if (!worksIn(actor.member, branchId)) throw new ApiError("forbidden");
    await lockProvider(tx, actor.clinicId, actor.membershipId);
    await this.lockRows(tx, actor, { patientId, branchId }, (member, patient) =>
      // Re-read under the lock: the guard's branches may be up to 30 seconds old (ADR-0009).
      worksIn(member, branchId) ? walkInReaches(patient, branchId) || "not_found" : "forbidden",
    );
    return { branchId, patientId, providerMembershipId: actor.membershipId, appointmentId: null };
  }

  // ADR-0027, after the provider lock (and the appointment row): the membership row, the patient row, the
  // branch row. Each one the INSERT references is locked at its place, so none can change under it.
  // `reaches` judges the locked member and file before the file's status is told (a file the caller
  // may not reach stays `not_found`).
  private async lockRows(
    tx: Tx,
    actor: MedicalActor,
    target: { readonly patientId: string; readonly branchId: string },
    reaches: (member: MemberBranches, patient: MedicalPatient) => true | "forbidden" | "not_found",
  ): Promise<void> {
    const { clinicId } = actor;
    const { patientId, branchId } = target;
    const member = await this.deps.members.lockForWrite(tx, clinicId, actor.membershipId);
    if (member === null || !member.active) throw new ApiError("forbidden");
    const patient = await this.deps.patients.lockForVisit(tx, clinicId, patientId);
    if (patient === null) throw new ApiError("not_found");
    const branches: MemberBranches = member.allBranches
      ? { all: true }
      : { all: false, branchIds: member.branchIds };
    const reached = reaches(branches, patient);
    if (reached !== true) throw new ApiError(reached);
    if (!patient.active) throw new ApiError("patient_inactive");
    const branch = await this.deps.branches.lockForFiling(tx, clinicId, branchId);
    if (branch === null) throw new ApiError("not_found");
    if (!branch.isActive) throw new ApiError("branch_inactive");
  }

  // The creator is the provider, so the patient is its own (R1-18); the content still follows its keys.
  private async answer(tx: Tx, actor: MedicalActor, id: string): Promise<VisitWriteResponse> {
    const visit = await findVisit(tx, actor.clinicId, id);
    if (visit === null) throw new ApiError("not_found");
    return { visit: await visitDetail(readContext(this.deps, tx), actor, visit, true) };
  }
}
