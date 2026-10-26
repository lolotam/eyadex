import type { ReportExport, ReportId } from "@eyadex/contracts/finance-reports";
import type { PermissionScope } from "@eyadex/contracts/permissions";
import type { Tx } from "@eyadex/db";

import type { FrozenExportAdmission } from "../domain/report-export-admission.ts";

/** صف التصدير وقت القبول: `queued` ومحاولة 0، من غير مفتاح تخزين ولا مراجعين. */
export interface QueuedReportExport {
  readonly clinicId: string;
  readonly id: string;
  readonly requestedBy: string;
  readonly report: ReportId;
  readonly params: FrozenExportAdmission["params"];
  readonly format: ReportExport["format"];
  readonly scope: PermissionScope;
  readonly createdAt: Date;
}

/**
 * تخزين طلبات التصدير. المالية بتكتب جدولها بس؛ الفروع بتيجي من `BillingBranchReader`.
 */
export interface ReportExportStore {
  /**
   * بيقفل طابور تصدير العيادة لنهاية الـ transaction، عشان سقف الطابور مايتعداش من طلبين مع بعض.
   *
   * @param tx الـ transaction جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @returns بيخلص لما القفل يتاخد
   */
  lockClinic(tx: Tx, clinicId: string): Promise<void>;

  /**
   * عدد صفوف `queued` في العيادة. صف `running` مش من الطابور.
   *
   * @param tx الـ transaction بعد قفل الطابور
   * @param clinicId العيادة
   * @returns العدد
   */
  countQueued(tx: Tx, clinicId: string): Promise<number>;

  /**
   * العضو عنده تصدير `running` ولا لأ. القيد الفريد بيمسك التاني، والقرار هنا قبل الإدراج.
   *
   * @param tx الـ transaction بعد قفل الطابور
   * @param clinicId العيادة
   * @param membershipId العضو الطالب
   * @returns `true` لو فيه صف شغال
   */
  memberHasRunning(tx: Tx, clinicId: string, membershipId: string): Promise<boolean>;

  /**
   * بيدرج محاولة واحدة `queued` بمحاولة 0. `patient_ids` و`storage_key` فاضيين لحد النشر.
   *
   * @param tx الـ transaction بعد قرار القبول
   * @param row الصف المجمّد
   * @returns بيخلص لما الصف يتكتب
   */
  insertQueued(tx: Tx, row: QueuedReportExport): Promise<void>;

  /**
   * بيانات العقد لصاحب الطلب بس. مفيش params ولا مفتاح ولا عقد إيجار.
   *
   * @param tx الـ transaction جوه عيادة الطالب
   * @param clinicId العيادة
   * @param membershipId العضو الطالب
   * @param exportId id التصدير
   * @returns الصف أو `null` لو مش بتاعه
   */
  readForRequester(
    tx: Tx,
    clinicId: string,
    membershipId: string,
    exportId: string,
  ): Promise<ReportExport | null>;
}
