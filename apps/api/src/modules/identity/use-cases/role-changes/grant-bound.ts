import type { Tx } from "@eyadex/db";

import { ApiError } from "../../../../shared/errors.ts";
import { keysBeyondActor } from "../../domain/role-rules.ts";
import { readEnabledModules, readRoleKeys } from "../../persistence/pg-role-store.ts";

/** الفاعل كما الـ guard حلّه، ومعاه صلاحياته الفعلية (ADR-0017 حد المنح). */
export interface GrantingActor {
  readonly clinicId: string;
  readonly permissions: readonly string[];
}

/**
 * يرفض (`forbidden`) أي عملية بتحطّ حد على دور فيه مفتاح فعّال الفاعل مايملكوش: تغيير دور عضو،
 * دعوة، إعادة إرسال الدعوة أو نسخ رابطها، إعادة تفعيل عضو، وإعادة تفعيل الدور نفسه. المفاتيح
 * والموديولات بتتقري جوه نفس الـ transaction.
 *
 * @param tx transaction العيادة
 * @param actor الفاعل
 * @param roleId الدور اللي بيتمنح
 * @returns بيخلص لو مسموح
 */
export async function assertMayGrantRole(
  tx: Tx,
  actor: GrantingActor,
  roleId: string,
): Promise<void> {
  const keys = await readRoleKeys(tx, actor.clinicId, roleId);
  const modules = await readEnabledModules(tx, actor.clinicId);
  if (keysBeyondActor(keys, [], actor.permissions, modules).length > 0) {
    throw new ApiError("forbidden");
  }
}
