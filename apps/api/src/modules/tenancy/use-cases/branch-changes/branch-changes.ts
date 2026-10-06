import type {
  BranchDetail,
  CreateBranchRequest,
  UpdateBranchRequest,
} from "@eyadex/contracts/branches";
import type { Database, Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";
import { maskPhone, maskPhonesInText } from "@eyadex/observability";

import {
  claimClinicIdempotencyKey,
  completeClinicIdempotencyKey,
} from "../../../../shared/clinic-idempotency.ts";
import { writeClinicAudit } from "../../../../shared/clinic-audit.ts";
import { ApiError } from "../../../../shared/errors.ts";
import { requestHash } from "../../../../shared/idempotency.ts";
import {
  branchAuditSnapshot,
  decideBranchDeactivation,
  decideBranchReactivation,
} from "../../domain/branch-rules.ts";
import { branchesUsage, checkLimit, limitReachedDetails } from "../../domain/limits.ts";
import type { Clock } from "../../ports/clock.ts";
import {
  countActiveBranches,
  findBranch,
  findBranchForUpdate,
  insertBranch,
  lockClinicBranches,
  readMaxBranches,
  saveBranch,
} from "../../persistence/pg-branch-store.ts";

/** اللي الـ use cases محتاجينه: pool العيادة (`eyadex_app`)، الوقت، والـ ids. */
export interface BranchChangesDeps {
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/** الفاعل: عضو العيادة اللي الـ guard حلّه. */
export interface BranchActor {
  readonly clinicId: string;
  readonly userId: string;
}

/** نتيجة تغيير: الفرع بعده، وهل حصل تغيير فعلاً (عشان المنادي يبطّل الكاش بس لو اتغيّر). */
export interface BranchChange {
  readonly branch: BranchDetail;
  readonly changed: boolean;
}

// The append-only audit keeps no full phone number (AGENTS.md review rules), not even one typed into a name
// or the address: the last 3 digits show a change.
const auditSnapshot = (branch: Parameters<typeof branchAuditSnapshot>[0]) => {
  const snapshot = branchAuditSnapshot(branch);
  return {
    ...snapshot,
    nameAr: maskPhonesInText(snapshot.nameAr),
    nameEn: maskPhonesInText(snapshot.nameEn),
    address: snapshot.address === null ? null : maskPhonesInText(snapshot.address),
    phone: snapshot.phone === null ? null : maskPhone(snapshot.phone),
  };
};

/**
 * إنشاء/تعديل/تعطيل/تفعيل الفروع (stories 31–34، ADR-0011). كل عملية transaction واحدة جوه
 * `withTenant`، فيها صف واحد في سجل العيادة. الحد و OD-7 بيتقرروا جوه الـ transaction تحت قفل
 * فروع العيادة، فطلبين متوازيين مايعدّوش الحد ولا يعطّلوا آخر فرعين مع بعض. إبطال الكاش بعد الـ
 * commit عند المنادي (`identity`)، لأن `tenancy` ماتستوردش `identity`.
 */
export class BranchChanges {
  constructor(private readonly deps: BranchChangesDeps) {}

  /**
   * فرع جديد بمفتاح `Idempotency-Key` إلزامي: الإعادة بترجع نفس الفرع ومابتاكلش من الحد تاني.
   *
   * @param actor الفاعل
   * @param input الجسم بعد الـ contract
   * @param idempotencyKey المفتاح
   * @returns الفرع؛ `changed=false` لو ده replay
   */
  async create(
    actor: BranchActor,
    input: CreateBranchRequest,
    idempotencyKey: string,
  ): Promise<BranchChange> {
    const { db, clock, ids } = this.deps;
    const now = clock.now();
    const { clinicId } = actor;
    const claim = {
      clinicId,
      scope: `branch:create:${actor.userId}`,
      key: idempotencyKey,
      hash: requestHash(input),
    };
    return db.withTenant(clinicId, async (tx) => {
      const claimed = await claimClinicIdempotencyKey<{ branchId: string }>(
        tx,
        claim,
        ids.newId(),
        now,
      );
      if (claimed.kind === "conflict") throw new ApiError("idempotency_conflict");
      if (claimed.kind === "replay") {
        const branch = await findBranch(tx, clinicId, claimed.response.branchId);
        if (branch === null) throw new ApiError("not_found");
        return { branch, changed: false };
      }
      await lockClinicBranches(tx, clinicId);
      await this.assertRoom(tx, clinicId);
      const branch = {
        id: ids.newId(),
        nameAr: input.nameAr,
        nameEn: input.nameEn,
        address: input.address ?? null,
        phone: input.phone ?? null,
        isActive: true,
      };
      await insertBranch(tx, clinicId, branch, now);
      await this.audit(tx, actor, "branch.created", branch.id, {
        after: auditSnapshot(branch),
      });
      await completeClinicIdempotencyKey(tx, claim, { branchId: branch.id });
      return { branch: await this.reload(tx, clinicId, branch.id), changed: true };
    });
  }

  /**
   * يعدّل الأسماء/العنوان/التليفون. طلب مابيغيّرش حاجة مابيكتبش ولا بيسجّل.
   *
   * @param actor الفاعل
   * @param branchId الفرع
   * @param input الحقول المتغيّرة
   * @returns الفرع بعد التعديل؛ فرع مش في العيادة دي → `not_found`
   */
  async update(
    actor: BranchActor,
    branchId: string,
    input: UpdateBranchRequest,
  ): Promise<BranchChange> {
    return this.change(actor, branchId, false, async (tx, before) => {
      const after: BranchDetail = {
        ...before,
        nameAr: input.nameAr ?? before.nameAr,
        nameEn: input.nameEn ?? before.nameEn,
        address: input.address === undefined ? before.address : input.address,
        phone: input.phone === undefined ? before.phone : input.phone,
      };
      const same = (["nameAr", "nameEn", "address", "phone"] as const).every(
        (field) => after[field] === before[field],
      );
      return same ? null : { after, action: "branch.updated" };
    });
  }

  /**
   * يعطّل فرع (OD-7: آخر فرع نشط مرفوض بـ `last_active_branch`). فرع معطّل أصلاً: مفيش تغيير.
   *
   * @param actor الفاعل
   * @param branchId الفرع
   * @returns الفرع بعد التعطيل
   */
  async deactivate(actor: BranchActor, branchId: string): Promise<BranchChange> {
    return this.change(actor, branchId, true, async (tx, before) => {
      const active = await countActiveBranches(tx, actor.clinicId);
      const decision = decideBranchDeactivation(before, active);
      if (decision === "already_inactive") return null;
      if (decision === "last_active_branch") throw new ApiError("last_active_branch");
      return { after: { ...before, isActive: false }, action: "branch.deactivated" };
    });
  }

  /**
   * يرجّع فرع معطّل؛ بيتحسب على الحد زي الإنشاء (SUB-03). فرع نشط أصلاً: مفيش تغيير.
   *
   * @param actor الفاعل
   * @param branchId الفرع
   * @returns الفرع بعد التفعيل؛ عند الحد → `limit_reached` بالأرقام
   */
  async reactivate(actor: BranchActor, branchId: string): Promise<BranchChange> {
    return this.change(actor, branchId, true, async (tx, before) => {
      const active = await countActiveBranches(tx, actor.clinicId);
      const max = await this.maxBranches(tx, actor.clinicId);
      const decision = decideBranchReactivation(before, active, max);
      if (decision === "already_active") return null;
      if (decision === "limit_reached") throw limitError(active, max);
      return { after: { ...before, isActive: true }, action: "branch.reactivated" };
    });
  }

  private async change(
    actor: BranchActor,
    branchId: string,
    lockClinic: boolean,
    decide: (
      tx: Tx,
      before: BranchDetail,
    ) => Promise<{ after: BranchDetail; action: string } | null>,
  ): Promise<BranchChange> {
    const { db, clock } = this.deps;
    const now = clock.now();
    const { clinicId } = actor;
    return db.withTenant(clinicId, async (tx) => {
      // Clinic lock before the row lock, in every path, so two writers never wait on each other crosswise.
      if (lockClinic) await lockClinicBranches(tx, clinicId);
      const before = await findBranchForUpdate(tx, clinicId, branchId);
      if (before === null) throw new ApiError("not_found");
      const decided = await decide(tx, before);
      if (decided === null) return { branch: before, changed: false };
      await saveBranch(tx, clinicId, decided.after, now);
      await this.audit(tx, actor, decided.action, branchId, {
        before: auditSnapshot(before),
        after: auditSnapshot(decided.after),
      });
      return { branch: await this.reload(tx, clinicId, branchId), changed: true };
    });
  }

  private async assertRoom(tx: Tx, clinicId: string): Promise<void> {
    const active = await countActiveBranches(tx, clinicId);
    const max = await this.maxBranches(tx, clinicId);
    if (checkLimit(branchesUsage(active, max)).kind === "exceeded") throw limitError(active, max);
  }

  private async maxBranches(tx: Tx, clinicId: string): Promise<number> {
    const max = await readMaxBranches(tx, clinicId);
    if (max === null) throw new ApiError("not_found");
    return max;
  }

  private async reload(tx: Tx, clinicId: string, branchId: string): Promise<BranchDetail> {
    const branch = await findBranch(tx, clinicId, branchId);
    if (branch === null) throw new ApiError("not_found");
    return branch;
  }

  private audit(
    tx: Tx,
    actor: BranchActor,
    action: string,
    branchId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    return writeClinicAudit(tx, {
      clinicId: actor.clinicId,
      id: this.deps.ids.newId(),
      actorUserId: actor.userId,
      action,
      entityType: "branch",
      entityId: branchId,
      details,
      createdAt: this.deps.clock.now(),
    });
  }
}

const limitError = (used: number, max: number) =>
  new ApiError(
    "limit_reached",
    limitReachedDetails("branches", checkLimit(branchesUsage(used, max))),
  );
