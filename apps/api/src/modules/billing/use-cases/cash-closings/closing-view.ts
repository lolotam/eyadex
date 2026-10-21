import type { CashClosingDetail, CashMovement } from "@eyadex/contracts/finance";
import type { Tx } from "@eyadex/db";

import { ApiError } from "../../../../shared/errors.ts";
import type { MemberBranches } from "../../domain/billing-actor.ts";
import type { DrawerMovement } from "../../domain/cash-closing-rules.ts";
import { reachesBranch } from "../../domain/invoice-reach.ts";
import { readClosing } from "../../persistence/pg-cash-closings.ts";
import { drawerMovements } from "../../persistence/pg-cash-drawer.ts";

/**
 * حركة الدرج زي ما قاعدة المتوقع بتقراها: نوعها ورقمها النقدي ومبلغها كـ bigint.
 *
 * @param movement الحركة زي ما الـ API بيرجعها
 * @returns الحركة زي ما `expectedCash` بيقراها
 */
export const drawerMovement = (movement: CashMovement): DrawerMovement => ({
  kind: movement.kind,
  cashSeq: BigInt(movement.cashSeq),
  amountMinor: BigInt(movement.amountMinor),
});

/**
 * إقفال واحد بحركات فترته النقدية (أرقام الإيصالات والمرتجعات ومبالغها، من غير أسماء مراجعين)، لو
 * فرعه في نطاق الفاعل؛ برا النطاق = `not_found` زي إقفال عيادة تانية (ISO-02).
 *
 * @param tx الـ transaction جوه `withTenant(clinicId)`
 * @param clinicId العيادة
 * @param reach نطاق الفاعل
 * @param closingId الإقفال
 * @returns الإقفال بحركاته
 * @throws ApiError `not_found` لما الإقفال مش موجود أو برا النطاق
 */
export async function closingInReach(
  tx: Tx,
  clinicId: string,
  reach: MemberBranches,
  closingId: string,
): Promise<CashClosingDetail> {
  const closing = await readClosing(tx, clinicId, closingId);
  if (closing === null || !reachesBranch(reach, closing.branchId)) throw new ApiError("not_found");
  const movements = await drawerMovements(
    tx,
    clinicId,
    closing.branchId,
    BigInt(closing.fromCashSeq),
    BigInt(closing.toCashSeq),
  );
  return { ...closing, movements };
}
