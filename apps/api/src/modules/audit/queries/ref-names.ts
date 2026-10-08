import type { Tx } from "@eyadex/db";

import type { RefIds, RefNames } from "../domain/audit-refs.ts";
import type { AuditNameReaders } from "../ports/audit-name-readers.ts";

/**
 * أسماء الأدوار والفروع اللي في لقطات صفحة، جوه transaction العيادة (RLS بيقصرها عليها)، من ports
 * السجل: الأدوار من identity والفروع من tenancy، نداء واحد لكل نوع. على pool المنصة ده بيستخدم بس
 * الـ SELECT اللي عندها أصلاً على `roles` و`branches` (0013).
 *
 * @param tx الـ transaction جوه `withTenant(clinicId)`
 * @param readers قرّاء الأسماء
 * @param clinicId العيادة
 * @param ids الـ ids المطلوبة
 * @returns الأسماء بالـ id
 */
export async function readRefNames(
  tx: Tx,
  readers: Pick<AuditNameReaders, "roles" | "branches">,
  clinicId: string,
  ids: RefIds,
): Promise<RefNames> {
  return {
    roles: await readers.roles.namesOf(tx, clinicId, ids.roles),
    branches: await readers.branches.namesOf(tx, clinicId, ids.branches),
  };
}
