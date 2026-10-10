import type { ClinicService, ServiceStatus } from "@eyadex/contracts/services";
import { DatabaseError, type Database, type Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";

import { writeClinicAudit } from "../../../../shared/clinic-audit.ts";
import {
  claimClinicIdempotencyKey,
  completeClinicIdempotencyKey,
} from "../../../../shared/clinic-idempotency.ts";
import { ApiError } from "../../../../shared/errors.ts";
import { requestHash } from "../../../../shared/idempotency.ts";
import type { Clock } from "../../../tenancy/index.ts";
import {
  isServiceUnchanged,
  serviceAuditSnapshot,
  type ServiceFields,
  type ServiceRecord,
} from "../../domain/service-rules.ts";
import {
  findService,
  insertService,
  lockClinicServices,
  saveService,
  serviceNameTaken,
} from "../../persistence/pg-service-store.ts";

export interface ServiceChangesDeps {
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/** الفاعل: عضو العيادة اللي الـ guard حلّه. */
export interface ServiceActor {
  readonly clinicId: string;
  readonly userId: string;
}

// The unique indexes back the check under the lock; if one still fires it is the same answer.
function nameTakenOnUnique(error: unknown): never {
  if (error instanceof DatabaseError && error.code === "23505")
    throw new ApiError("service_name_taken");
  throw error;
}

/**
 * قايمة خدمات العيادة (D-12، ADR-0026 §1): إنشاء بمفتاح `Idempotency-Key`، تعديل، تعطيل وإعادة تفعيل.
 * كل عملية transaction واحدة تحت قفل خدمات العيادة، فيها صف سجل إداري واحد. مفيش حذف.
 */
export class ServiceChanges {
  constructor(private readonly deps: ServiceChangesDeps) {}

  /**
   * خدمة جديدة نشطة. نفس المفتاح ونفس الجسم = نفس الخدمة؛ جسم مختلف = `idempotency_conflict`.
   *
   * @param actor الفاعل
   * @param input الأسماء والمدة بعد `serviceInputSchema`
   * @param idempotencyKey المفتاح
   * @returns الخدمة
   */
  create(
    actor: ServiceActor,
    input: ServiceFields,
    idempotencyKey: string,
  ): Promise<ClinicService> {
    const { db, clock, ids } = this.deps;
    const claim = {
      clinicId: actor.clinicId,
      scope: `service:create:${actor.userId}`,
      key: idempotencyKey,
      hash: requestHash(input),
    };
    return db
      .withTenant(actor.clinicId, async (tx) => {
        const claimed = await claimClinicIdempotencyKey<{ serviceId: string }>(
          tx,
          claim,
          ids.newId(),
          clock.now(),
        );
        if (claimed.kind === "conflict") throw new ApiError("idempotency_conflict");
        if (claimed.kind === "replay") return this.reload(tx, actor, claimed.response.serviceId);
        await lockClinicServices(tx, actor.clinicId);
        if (await serviceNameTaken(tx, actor.clinicId, input, null)) {
          throw new ApiError("service_name_taken");
        }
        const service: ServiceRecord = { id: ids.newId(), ...input, status: "active" };
        await insertService(tx, actor.clinicId, service, clock.now());
        await this.audit(tx, actor, "service.created", null, service);
        await completeClinicIdempotencyKey(tx, claim, { serviceId: service.id });
        return this.reload(tx, actor, service.id);
      })
      .catch(nameTakenOnUnique);
  }

  /**
   * يعدّل الأسماء والمدة؛ نفس القيم = نفس الرد من غير صف سجل.
   *
   * @param actor الفاعل
   * @param id الخدمة
   * @param input الأسماء والمدة
   * @returns الخدمة بعد التعديل
   */
  update(actor: ServiceActor, id: string, input: ServiceFields): Promise<ClinicService> {
    return this.change(actor, id, async (tx, before) => {
      if (isServiceUnchanged(before, input)) return null;
      if (await serviceNameTaken(tx, actor.clinicId, input, id)) {
        throw new ApiError("service_name_taken");
      }
      return { next: { ...before, ...input }, action: "service.updated" };
    }).catch(nameTakenOnUnique);
  }

  /**
   * تعطيل أو إعادة تفعيل؛ نفس الحالة = نفس الرد من غير صف سجل.
   *
   * @param actor الفاعل
   * @param id الخدمة
   * @param status الحالة المطلوبة
   * @returns الخدمة بعد التغيير
   */
  setStatus(actor: ServiceActor, id: string, status: ServiceStatus): Promise<ClinicService> {
    return this.change(actor, id, async (_tx, before) => {
      if (before.status === status) return null;
      const action = status === "inactive" ? "service.deactivated" : "service.reactivated";
      return { next: { ...before, status }, action };
    });
  }

  private change(
    actor: ServiceActor,
    id: string,
    decide: (
      tx: Tx,
      before: ServiceRecord,
    ) => Promise<{ next: ServiceRecord; action: string } | null>,
  ): Promise<ClinicService> {
    const { db, clock } = this.deps;
    return db.withTenant(actor.clinicId, async (tx) => {
      await lockClinicServices(tx, actor.clinicId);
      const before = await findService(tx, actor.clinicId, id);
      if (before === null) throw new ApiError("not_found");
      const decided = await decide(tx, before);
      if (decided === null) return before;
      await saveService(tx, actor.clinicId, decided.next, clock.now());
      await this.audit(tx, actor, decided.action, before, decided.next);
      return this.reload(tx, actor, id);
    });
  }

  private async audit(
    tx: Tx,
    actor: ServiceActor,
    action: string,
    before: ServiceRecord | null,
    after: ServiceRecord,
  ): Promise<void> {
    await writeClinicAudit(tx, {
      clinicId: actor.clinicId,
      id: this.deps.ids.newId(),
      actorUserId: actor.userId,
      action,
      entityType: "clinic_service",
      entityId: after.id,
      details: {
        before: before === null ? null : serviceAuditSnapshot(before),
        after: serviceAuditSnapshot(after),
      },
      createdAt: this.deps.clock.now(),
    });
  }

  private async reload(tx: Tx, actor: ServiceActor, id: string): Promise<ClinicService> {
    const service = await findService(tx, actor.clinicId, id);
    if (service === null) throw new ApiError("not_found");
    return service;
  }
}
