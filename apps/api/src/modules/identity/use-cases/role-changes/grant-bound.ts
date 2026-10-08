import type { Tx } from "@eyadex/db";

import { ApiError } from "../../../../shared/errors.ts";
import {
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

/**
 * يرفض (`forbidden`) كتابة تعريف دور إلا لو الفاعل، كما هو في الداتابيز دلوقتي، على كل الفروع
 * ومفاتيحه المخزّنة بتغطي مفاتيح الدور. المنادي ماسك قفل `roles:` الأول (ADR-0017 §6).
 *
 * @param tx transaction العيادة
 * @param actor الفاعل
 * @param roleKeys مفاتيح الدور المستهدف
 * @returns بيخلص لو مسموح
 */
export async function assertMayDefineRole(
  tx: Tx,
  actor: GrantingActor,
  roleKeys: readonly string[],
): Promise<void> {
  const member = await readGrantingMember(tx, actor.clinicId, actor.userId);
  if (decideRoleDefinition(member, roleKeys) === "forbidden") throw new ApiError("forbidden");
}

/**
 * يرفض (`forbidden`) منح دور لحد إلا لو مفاتيح الفاعل المخزّنة بتغطي مفاتيح الدور، ووصول الهدف
 * للفروع جوه وصول الفاعل. المنادي ماسك قفل `roles:` الأول (ADR-0017 §6).
 *
 * @param tx transaction العيادة
 * @param actor الفاعل
 * @param roleId الدور اللي بيتمنح
 * @param target وصول العضو أو الدعوة للفروع بعد العملية
 * @returns بيخلص لو مسموح
 */
export async function assertMayGrantRole(
  tx: Tx,
  actor: GrantingActor,
  roleId: string,
  target: BranchReach,
): Promise<void> {
  const member = await readGrantingMember(tx, actor.clinicId, actor.userId);
  const keys = await readRoleKeys(tx, actor.clinicId, roleId);
  if (decideRoleGrant(member, keys, target) === "forbidden") throw new ApiError("forbidden");
}
