import type { Tx } from "@eyadex/db";

import type { BillingActor } from "../domain/billing-actor.ts";
import { reachesBranch, type ViewReach } from "../domain/invoice-reach.ts";
import type { BillingPatientReader } from "../ports/billing-patients.ts";

/**
 * الفاتورة جوه نطاق عرض الفاعل (spec §8 rule 12): `own` = مراجع من مراجعينه في أي فرع، غير كده فرعها من
 * فروعه. اللي برا النطاق بيترد عليه `not_found` زي فاتورة عيادة تانية (ISO-02).
 *
 * @param tx الـ transaction جوه `withTenant(clinicId)`
 * @param patients قارئ ملفات المراجعين
 * @param actor الفاعل
 * @param reach نطاق عرضه
 * @param invoice مراجع الفاتورة وفرعها
 * @returns صح لو يقدر يشوفها
 */
export async function invoiceVisible(
  tx: Tx,
  patients: BillingPatientReader,
  actor: BillingActor,
  reach: ViewReach,
  invoice: { readonly patientId: string; readonly branchId: string },
): Promise<boolean> {
  return "own" in reach
    ? (await patients.access(tx, actor.clinicId, actor, invoice.patientId)).own
    : reachesBranch(reach, invoice.branchId);
}
