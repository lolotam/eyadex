import type { Refund } from "@eyadex/contracts/finance";
import type { Tx } from "@eyadex/db";

import { ApiError } from "../../../../shared/errors.ts";
import type { MemberBranches } from "../../domain/billing-actor.ts";
import { reachesBranch } from "../../domain/invoice-reach.ts";
import { readRefund } from "../../persistence/pg-refund-reads.ts";
import type { BillingPatientReader } from "../../ports/billing-patients.ts";

/**
 * سند صرف واحد باسم المراجع، لو فرعه في نطاق الفاعل؛ برا النطاق = `not_found` زي سند عيادة تانية
 * (ISO-02). اسم المراجع مش فتحة ملف، فمفيش صف سجل وصول (§8c item 4).
 *
 * @param tx الـ transaction جوه `withTenant(clinicId)`
 * @param patients بوابة المراجعين
 * @param clinicId العيادة
 * @param reach نطاق الفاعل
 * @param refundId الاسترداد
 * @returns الاسترداد باسم المراجع
 * @throws ApiError `not_found` لما الاسترداد مش موجود أو برا النطاق
 */
export async function refundInReach(
  tx: Tx,
  patients: Pick<BillingPatientReader, "displayName">,
  clinicId: string,
  reach: MemberBranches,
  refundId: string,
): Promise<Refund> {
  const refund = await readRefund(tx, clinicId, refundId);
  if (refund === null || !reachesBranch(reach, refund.branchId)) throw new ApiError("not_found");
  const patientName = await patients.displayName(tx, clinicId, refund.patientId);
  if (patientName === null) throw new ApiError("not_found");
  return { ...refund, patientName };
}
