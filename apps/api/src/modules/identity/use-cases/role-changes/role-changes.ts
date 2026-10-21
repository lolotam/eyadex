import type { RoleSummary } from "@eyadex/contracts/access";
import type { PermissionKey } from "@eyadex/contracts/permissions";
import type { CreateRoleRequest, UpdateRoleRequest } from "@eyadex/contracts/role-admin";
import { DatabaseError, type Database, type Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";
import { scrubAuditText } from "@eyadex/observability";

import {
  claimClinicIdempotencyKey,
  completeClinicIdempotencyKey,
} from "../../../../shared/clinic-idempotency.ts";
import { writeClinicAudit } from "../../../../shared/clinic-audit.ts";
import { ApiError } from "../../../../shared/errors.ts";
import { requestHash } from "../../../../shared/idempotency.ts";
import type { Clock } from "../../../tenancy/index.ts";
import {
  decideRoleDeactivation,
  decideRoleReactivation,
  decideRoleUpdate,
  hiddenScopeGap,
  mergeHiddenKeys,
  roleAuditSnapshot,
  sameKeySet,
  sameRole,
  type RoleAuditSnapshot,
} from "../../domain/role-rules.ts";
import {
  countRoleMembers,
  findRoleForUpdate,
  insertRole,
  lockClinicRoles,
  readEnabledModules,
  replaceRolePermissions,
  saveRole,
  type RoleRow,
} from "../../persistence/pg-role-store.ts";
import { lockClinicBranches, lockClinicUsers } from "../../persistence/pg-user-store.ts";
import { findRoleSummary } from "../../queries/role-summary.ts";
import { assertActorMay, assertMayDefineRole } from "./grant-bound.ts";

export interface RoleChangesDeps {
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/** الفاعل: عضو العيادة اللي الـ guard حلّه؛ حقه في تعريف الأدوار بيتقري من الداتابيز (ADR-0017 §6). */
export interface RoleActor {
  readonly clinicId: string;
  readonly userId: string;
}

/** نتيجة تغيير: الدور بعده، وهل حصل تغيير فعلًا (عشان المنادي يبطّل الكاش بس لو اتغيّر). */
export interface RoleChange {
  readonly role: RoleSummary;
  readonly changed: boolean;
}

type Decision = { readonly after: RoleRow; readonly action: string } | null;

const NAME_INDEXES = new Set(["roles_name_ar_unique", "roles_name_en_unique"]);

// Every free-text name goes through the strict audit scrub (invisible controls dropped, digits of any
// script folded, every 8+ digit run masked wherever it sits): `redactSecrets` keeps phone-like values, so a number typed into a
// role name would otherwise reach the append-only audit (AGENTS.md review rules).
const auditSnapshot = (role: RoleAuditSnapshot) => {
  const s = roleAuditSnapshot(role);
  return { ...s, nameAr: scrubAuditText(s.nameAr), nameEn: scrubAuditText(s.nameEn) };
};

/** The 0018 indexes decide name clashes, so two parallel writes can never both pass. */
async function mapNameClash<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof DatabaseError && NAME_INDEXES.has(error.constraint ?? "")) {
      throw new ApiError("role_name_taken");
    }
    throw error;
  }
}

/**
 * إنشاء/تعديل/تعطيل/تفعيل الأدوار (stories 46–52، ADR-0017). كل عملية transaction واحدة جوه
 * `withTenant` فيها صف واحد في سجل العيادة. الدور المقفول (أدمن العيادة) بيرفض أي كتابة. إبطال
 * الكاش بعد الـ commit عند المنادي.
 */
export class RoleChanges {
  constructor(private readonly deps: RoleChangesDeps) {}

  /**
   * دور مخصص جديد بمفتاح `Idempotency-Key` إلزامي: الإعادة بترجع نفس الدور من غير صف تاني.
   *
   * @param actor الفاعل
   * @param input الجسم بعد الـ contract
   * @param idempotencyKey المفتاح
   * @returns الدور؛ `changed=false` لو ده replay
   */
  create(actor: RoleActor, input: CreateRoleRequest, idempotencyKey: string): Promise<RoleChange> {
    const { db, clock, ids } = this.deps;
    const now = clock.now();
    const { clinicId } = actor;
    // A key set is a set: the same keys in another order are the same request.
    const body = { ...input, permissionKeys: [...input.permissionKeys].sort() };
    const claim = {
      clinicId,
      scope: `role:create:${actor.userId}`,
      key: idempotencyKey,
      hash: requestHash(body),
    };
    return mapNameClash(() =>
      db.withTenant(clinicId, async (tx) => {
        await lockClinicRoles(tx, clinicId);
        // Before any row, the idempotency claim included: the guard's grant may have been revoked.
        await assertActorMay(tx, actor, "create:roles:clinic");
        const claimed = await claimClinicIdempotencyKey<{ roleId: string }>(
          tx,
          claim,
          ids.newId(),
          now,
        );
        if (claimed.kind === "conflict") throw new ApiError("idempotency_conflict");
        if (claimed.kind === "replay") {
          return { role: await this.reload(tx, clinicId, claimed.response.roleId), changed: false };
        }
        const modules = await readEnabledModules(tx, clinicId);
        const keys = mergeHiddenKeys(body.permissionKeys, [], modules);
        await assertMayDefineRole(tx, actor, "create:roles:clinic", keys);
        const role = { id: ids.newId(), nameAr: input.nameAr, nameEn: input.nameEn };
        await insertRole(tx, clinicId, role, now);
        await replaceRolePermissions(tx, clinicId, role.id, keys, () => ids.newId(), now);
        await this.audit(tx, actor, "role.created", role.id, {
          after: auditSnapshot({ ...role, isActive: true, permissionKeys: keys }),
        });
        await completeClinicIdempotencyKey(tx, claim, { roleId: role.id });
        return { role: await this.reload(tx, clinicId, role.id), changed: true };
      }),
    );
  }

  /**
   * يعدّل الاسمين والمفاتيح. مفاتيح الموديولات المقفولة بتفضل زي ما هي مهما كان الطلب (FLAG-02).
   *
   * @param actor الفاعل
   * @param roleId الدور
   * @param input الدور كله بعد الـ contract
   * @returns الدور بعد التعديل؛ مقفول → `role_locked`، مش في العيادة → `not_found`
   */
  update(actor: RoleActor, roleId: string, input: UpdateRoleRequest): Promise<RoleChange> {
    return this.change(actor, roleId, "update:roles:clinic", false, async (tx, before) => {
      if (decideRoleUpdate(before) === "locked") throw new ApiError("role_locked");
      const modules = await readEnabledModules(tx, actor.clinicId);
      const keys = mergeHiddenKeys(input.permissionKeys, before.permissionKeys, modules);
      // The request carries no keys of a switched-off module, so the contract never saw the kept ones.
      const gap = hiddenScopeGap(keys);
      if (gap) throw new ApiError("role_hidden_keys_invalid", { module: gap });
      const after = { ...before, nameAr: input.nameAr, nameEn: input.nameEn, permissionKeys: keys };
      if (sameRole(before, after)) return null;
      // The role as it will be; the role as it is was checked in change().
      await assertMayDefineRole(tx, actor, "update:roles:clinic", keys);
      return { after, action: "role.updated" };
    });
  }

  /**
   * يعطّل دور مفيش عليه أي عضوية (بأي حالة)؛ غير كده `role_in_use` بالعدد (story 51).
   *
   * @param actor الفاعل
   * @param roleId الدور
   * @returns الدور بعد التعطيل؛ معطّل أصلًا → مفيش تغيير
   */
  deactivate(actor: RoleActor, roleId: string): Promise<RoleChange> {
    // Users lock, then branches lock (ADR-0012 order): role changes, invites and member
    // reactivations hold the first, invitation acceptance the second, so no holder slips in.
    return this.change(actor, roleId, "deactivate:roles:clinic", true, async (tx, before) => {
      const count = await countRoleMembers(tx, actor.clinicId, roleId);
      const decision = decideRoleDeactivation(before, count);
      if (decision === "locked") throw new ApiError("role_locked");
      if (decision === "already_inactive") return null;
      if (decision === "in_use") throw new ApiError("role_in_use", { count });
      return { after: { ...before, isActive: false }, action: "role.deactivated" };
    });
  }

  /**
   * يرجّع دور معطّل؛ أعضاؤه (لو فيه) بيرجعلهم أثره. حد التعريف (في `change`) بيمنع فاعل أضعف
   * من الدور إنه يرجّعه.
   *
   * @param actor الفاعل
   * @param roleId الدور
   * @returns الدور بعد التفعيل؛ نشط أصلًا → مفيش تغيير
   */
  reactivate(actor: RoleActor, roleId: string): Promise<RoleChange> {
    return this.change(actor, roleId, "deactivate:roles:clinic", false, async (_tx, before) => {
      const decision = decideRoleReactivation(before);
      if (decision === "locked") throw new ApiError("role_locked");
      if (decision === "already_active") return null;
      return { after: { ...before, isActive: true }, action: "role.reactivated" };
    });
  }

  private change(
    actor: RoleActor,
    roleId: string,
    required: PermissionKey,
    lockMembers: boolean,
    decide: (tx: Tx, before: RoleRow) => Promise<Decision>,
  ): Promise<RoleChange> {
    const { db, clock, ids } = this.deps;
    const { clinicId } = actor;
    return mapNameClash(() =>
      db.withTenant(clinicId, async (tx) => {
        // roles → users → branches → row, in every path (ADR-0017 §6): the actor is read after them.
        await lockClinicRoles(tx, clinicId);
        if (lockMembers) {
          await lockClinicUsers(tx, clinicId);
          await lockClinicBranches(tx, clinicId);
        }
        // The route's own permission, on the actor as it is after the locks (`@Require` ran before).
        await assertActorMay(tx, actor, required);
        const before = await findRoleForUpdate(tx, clinicId, roleId);
        if (before === null) throw new ApiError("not_found");
        // Every definition write needs an all-branch actor covering the role as it is.
        await assertMayDefineRole(tx, actor, required, before.permissionKeys);
        const decided = await decide(tx, before);
        if (decided === null) {
          return { role: await this.reload(tx, clinicId, roleId), changed: false };
        }
        const now = clock.now();
        await saveRole(tx, clinicId, decided.after, now);
        if (!sameKeySet(before.permissionKeys, decided.after.permissionKeys)) {
          const keys = decided.after.permissionKeys;
          await replaceRolePermissions(tx, clinicId, roleId, keys, () => ids.newId(), now);
        }
        await this.audit(tx, actor, decided.action, roleId, {
          before: auditSnapshot(before),
          after: auditSnapshot(decided.after),
        });
        return { role: await this.reload(tx, clinicId, roleId), changed: true };
      }),
    );
  }

  private async reload(tx: Tx, clinicId: string, roleId: string): Promise<RoleSummary> {
    const role = await findRoleSummary(tx, clinicId, roleId);
    if (role === null) throw new ApiError("not_found");
    return role;
  }

  private audit(
    tx: Tx,
    actor: RoleActor,
    action: string,
    roleId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    return writeClinicAudit(tx, {
      clinicId: actor.clinicId,
      id: this.deps.ids.newId(),
      actorUserId: actor.userId,
      action,
      entityType: "role",
      entityId: roleId,
      details,
      createdAt: this.deps.clock.now(),
    });
  }
}
