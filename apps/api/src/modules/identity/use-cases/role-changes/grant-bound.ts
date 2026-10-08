import type { PermissionKey } from "@eyadex/contracts/permissions";
import type { Tx } from "@eyadex/db";

import { ApiError } from "../../../../shared/errors.ts";
import {
  decideActorPermission,
  decideRoleDefinition,
  decideRoleGrant,
  type BranchReach,
} from "../../domain/grant-rules.ts";
import { readGrantingMember, readRoleKeys } from "../../persistence/pg-role-store.ts";

/** الفاعل: عضو العيادة اللي الـ guard حلّه (صلاحياته بتتقري من الداتابيز هنا، مش من السياق). */
export interface GrantingActor {
  readonly clinicId: string;
  readonly userId: string;
}

// Every helper reloads the actor and rechecks the route's own permission on it: the guard decided
// before the request waited on `roles:`, and a revocation may have committed meanwhile.

/**
 * يرفض (`forbidden`) لو الفاعل، كما هو في الداتابيز بعد الأقفال، مابقاش شايل صلاحية الـ route.
 * أول حاجة بعد الأقفال في كل كتابة ماسكة `roles:`، قبل أي صف (حتى مفتاح الـ idempotency).
 *
 * @param tx transaction العيادة
 * @param actor الفاعل
 * @param required صلاحية الـ route (نفس مفتاح `@Require`)
 * @returns بيخلص لو مسموح
 */
export async function assertActorMay(
  tx: Tx,
  actor: GrantingActor,
  required: PermissionKey,
): Promise<void> {
  const member = await readGrantingMember(tx, actor.clinicId, actor.userId);
  if (decideActorPermission(member, required) === "forbidden") throw new ApiError("forbidden");
}

/**
 * يرفض (`forbidden`) كتابة تعريف دور إلا لو الفاعل، كما هو في الداتابيز دلوقتي، لسه شايل صلاحية
 * الـ route، وعلى كل الفروع، ومفاتيحه المخزّنة بتغطي مفاتيح الدور.
 *
 * @param tx transaction العيادة
 * @param actor الفاعل
 * @param required صلاحية الـ route
 * @param roleKeys مفاتيح الدور المستهدف
 * @returns بيخلص لو مسموح
 */
export async function assertMayDefineRole(
  tx: Tx,
  actor: GrantingActor,
  required: PermissionKey,
  roleKeys: readonly string[],
): Promise<void> {
  const member = await readGrantingMember(tx, actor.clinicId, actor.userId);
  if (decideRoleDefinition(member, required, roleKeys) === "forbidden") {
    throw new ApiError("forbidden");
  }
}

/**
 * يرفض (`forbidden`) منح دور لحد إلا لو الفاعل لسه شايل صلاحية الـ route، ومفاتيحه المخزّنة بتغطي
 * مفاتيح الدور، ووصول الهدف للفروع جوه وصوله.
 *
 * @param tx transaction العيادة
 * @param actor الفاعل
 * @param required صلاحية الـ route
 * @param roleId الدور اللي بيتمنح
 * @param target وصول العضو أو الدعوة للفروع بعد العملية
 * @returns بيخلص لو مسموح
 */
export async function assertMayGrantRole(
  tx: Tx,
  actor: GrantingActor,
  required: PermissionKey,
  roleId: string,
  target: BranchReach,
): Promise<void> {
  const member = await readGrantingMember(tx, actor.clinicId, actor.userId);
  const keys = await readRoleKeys(tx, actor.clinicId, roleId);
  if (decideRoleGrant(member, required, keys, target) === "forbidden") {
    throw new ApiError("forbidden");
  }
}
