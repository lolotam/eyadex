import type { ChangeBranchesInput } from "@eyadex/contracts/users";
import type { MembershipUserView } from "@eyadex/contracts/users";
import type { Database, Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";
import { maskPhonesInText } from "@eyadex/observability";

import { writeClinicAudit } from "../../../../shared/clinic-audit.ts";
import { ApiError } from "../../../../shared/errors.ts";
import { checkLimit, limitReachedDetails, usersUsage, type Clock } from "../../../tenancy/index.ts";
import {
  decideMemberDeactivation,
  decideRoleChange,
  mayTouchAdminRole,
  personAuditSnapshot,
  reachesABranch,
  sameBranchSet,
  type PersonAuditSnapshot,
} from "../../domain/user-rules.ts";
import {
  activeRole,
  assertActiveBranches,
  countActiveAdmins,
  countActiveBranchesIn,
  findMemberForUpdate,
  isActiveAdminUser,
  lockClinicBranches,
  lockClinicUsers,
  readSeats,
  saveMemberBranches,
  saveMemberRoleAndStatus,
  type MemberRow,
} from "../../persistence/pg-user-store.ts";
import { findUserView } from "../../queries/user-views.ts";
import { lockClinicRoles } from "../../persistence/pg-role-store.ts";
import { assertMayGrantRole } from "../role-changes/grant-bound.ts";

export interface UserChangesDeps {
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/** الفاعل: عضو العيادة اللي الـ guard حلّه؛ حقه في المنح بيتقري من الداتابيز (ADR-0017 §6). */
export interface UserActor {
  readonly clinicId: string;
  readonly userId: string;
}

/** نتيجة تغيير: العضو بعده، اتغيّر ولا لأ، و`revoke` = حساب جلساته لازم تتلغي بعد الـ commit. */
export interface UserChange {
  readonly user: MembershipUserView;
  readonly changed: boolean;
  readonly revokeUserId: string | null;
}

type Decision = {
  readonly next: Pick<MemberRow, "roleId" | "status">;
  readonly action: string;
  readonly revoke?: boolean;
} | null;

/** seat limit error with the numbers ("3 of 3"). */
export const usersLimitError = (used: number, max: number) =>
  new ApiError("limit_reached", limitReachedDetails("users", checkLimit({ used, max })));

/** Only an active clinic admin may grant the admin role or act on an admin (ADR-0012 §15). */
export async function assertMayTouchAdmin(
  tx: Tx,
  actor: UserActor,
  roleKeys: readonly (string | null)[],
): Promise<void> {
  const actorIsAdmin = await isActiveAdminUser(tx, actor.clinicId, actor.userId);
  if (!mayTouchAdminRole(actorIsAdmin, roleKeys)) throw new ApiError("forbidden");
}

/**
 * تغيير دور/فروع/حالة عضو (stories 39–42، ADM-01، ADR-0012). كل عملية transaction واحدة تحت قفل
 * مستخدمي العيادة، فآخر أدمن والحد بيتقرروا من غير سباق. إلغاء الجلسات وإبطال الكاش عند المنادي
 * بعد الـ commit.
 */
export class UserChanges {
  constructor(private readonly deps: UserChangesDeps) {}

  /**
   * يغيّر دور عضو؛ نقل آخر أدمن نشط → `last_active_admin`.
   *
   * @param actor الفاعل
   * @param memberId العضوية
   * @param roleId الدور الجديد (نشط وفي العيادة دي)
   * @returns العضو بعد التغيير
   */
  changeRole(actor: UserActor, memberId: string, roleId: string): Promise<UserChange> {
    return this.change(actor, memberId, async (tx, before) => {
      // A no-op first: re-sending the current role answers 200 even if that role is now inactive.
      if (roleId === before.roleId) return null;
      const target = await activeRole(tx, actor.clinicId, roleId);
      await assertMayTouchAdmin(tx, actor, [target.systemKey]);
      // The member keeps its branch scope, so it must sit inside the actor's too.
      await assertMayGrantRole(tx, actor, target.id, before);
      const admins = await countActiveAdmins(tx, actor.clinicId);
      const decision = decideRoleChange(before, before.roleId, target, admins);
      if (decision === "same") return null;
      if (decision === "last_active_admin") throw new ApiError("last_active_admin");
      return { next: { roleId: target.id, status: before.status }, action: "user.role_changed" };
    });
  }

  /**
   * يغيّر فروع عضو (كل الفروع، أو فروع نشطة في العيادة دي).
   *
   * @param actor الفاعل
   * @param memberId العضوية
   * @param input `allBranches` أو `branchIds`
   * @returns العضو بعد التغيير
   */
  changeBranches(
    actor: UserActor,
    memberId: string,
    input: ChangeBranchesInput,
  ): Promise<UserChange> {
    const branchIds = input.allBranches ? [] : input.branchIds;
    return this.change(actor, memberId, async (tx, before) => {
      // A no-op first: re-sending the current set answers 200 even if one of them is now inactive.
      const same =
        before.allBranches === input.allBranches &&
        (input.allBranches || sameBranchSet(before.branchIds, branchIds));
      if (same) return null;
      // The stranded-members count of a branch deactivation reads these links under the branch lock.
      await lockClinicBranches(tx, actor.clinicId);
      await assertActiveBranches(tx, actor.clinicId, branchIds);
      // New branches grant the member's role there: the same bound as a role grant.
      await assertMayGrantRole(tx, actor, before.roleId, {
        allBranches: input.allBranches,
        branchIds,
      });
      const { clinicId } = actor;
      const { ids, clock } = this.deps;
      const newId = () => ids.newId();
      await saveMemberBranches(
        tx,
        clinicId,
        memberId,
        input.allBranches,
        branchIds,
        newId,
        clock.now(),
      );
      return { next: before, action: "user.branches_changed" };
    });
  }

  /**
   * يعطّل عضو؛ آخر أدمن نشط → `last_active_admin`. الجلسات بتتلغي بعد الـ commit.
   *
   * @param actor الفاعل
   * @param memberId العضوية
   * @returns العضو بعد التعطيل
   */
  deactivate(actor: UserActor, memberId: string): Promise<UserChange> {
    return this.change(actor, memberId, async (tx, before) => {
      const admins = await countActiveAdmins(tx, actor.clinicId);
      const decision = decideMemberDeactivation(before, admins);
      if (decision === "already_inactive") return null;
      if (decision === "last_active_admin") throw new ApiError("last_active_admin");
      return {
        next: { roleId: before.roleId, status: "deactivated" },
        action: "user.deactivated",
        revoke: true,
      };
    });
  }

  /**
   * يرجّع عضو معطّل؛ بيتحسب على حد المستخدمين (SUB-03)، ودوره لازم يكون نشط، ولازم يوصل لفرع نشط.
   *
   * @param actor الفاعل
   * @param memberId العضوية
   * @returns العضو بعد التفعيل؛ عند الحد → `limit_reached`، ومن غير فرع نشط → `branch_inactive`
   */
  reactivate(actor: UserActor, memberId: string): Promise<UserChange> {
    return this.change(actor, memberId, async (tx, before) => {
      if (before.status === "active") return null;
      await activeRole(tx, actor.clinicId, before.roleId);
      await assertMayGrantRole(tx, actor, before.roleId, before);
      // Under the branch lock, so a parallel branch deactivation cannot strand the member (ADR-0012 §16).
      await lockClinicBranches(tx, actor.clinicId);
      const reachable = await countActiveBranchesIn(tx, actor.clinicId, before.branchIds);
      if (!reachesABranch(before.allBranches, reachable)) throw new ApiError("branch_inactive");
      const seats = await readSeats(tx, actor.clinicId, this.deps.clock.now());
      const usage = usersUsage(seats.members, seats.invitations, seats.max);
      if (checkLimit(usage).kind === "exceeded") throw usersLimitError(usage.used, usage.max);
      return { next: { roleId: before.roleId, status: "active" }, action: "user.reactivated" };
    });
  }

  private change(
    actor: UserActor,
    memberId: string,
    decide: (tx: Tx, before: MemberRow) => Promise<Decision>,
  ): Promise<UserChange> {
    const { db, clock } = this.deps;
    const { clinicId } = actor;
    return db.withTenant(clinicId, async (tx) => {
      // Roles lock, then users lock, then the row: the same order in every path (ADR-0012, 0017 §6).
      await lockClinicRoles(tx, clinicId);
      await lockClinicUsers(tx, clinicId);
      const before = await findMemberForUpdate(tx, clinicId, memberId);
      if (before === null) throw new ApiError("not_found");
      await assertMayTouchAdmin(tx, actor, [before.roleSystemKey]);
      const beforeView = await this.view(tx, clinicId, memberId);
      const decided = await decide(tx, before);
      if (decided === null) return { user: beforeView, changed: false, revokeUserId: null };
      if (decided.next.roleId !== before.roleId || decided.next.status !== before.status) {
        await saveMemberRoleAndStatus(tx, clinicId, { id: memberId, ...decided.next }, clock.now());
      }
      const after = await this.view(tx, clinicId, memberId);
      await writeClinicAudit(tx, {
        clinicId,
        id: this.deps.ids.newId(),
        actorUserId: actor.userId,
        action: decided.action,
        entityType: "user",
        entityId: memberId,
        details: { before: auditSnapshot(beforeView), after: auditSnapshot(after) },
        createdAt: clock.now(),
      });
      return { user: after, changed: true, revokeUserId: decided.revoke ? before.userId : null };
    });
  }

  private async view(tx: Tx, clinicId: string, id: string): Promise<MembershipUserView> {
    const view = await findUserView(tx, clinicId, id);
    if (view === null) throw new ApiError("not_found");
    return view;
  }
}

// Every free-text name is masked: `redactSecrets` keeps phone-like values, so a number typed into a
// person's or a custom role's name would otherwise reach the audit log (AGENTS.md review rules).
export const auditSnapshot = (person: PersonAuditSnapshot) => {
  const s = personAuditSnapshot(person);
  return {
    ...s,
    fullName: maskPhonesInText(s.fullName),
    roleNameAr: maskPhonesInText(s.roleNameAr),
    roleNameEn: maskPhonesInText(s.roleNameEn),
  };
};
