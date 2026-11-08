import type { Tx } from "@eyadex/db";

/** مراجعات العرض المملوكة لوحدات المصدر، داخل معاملة العيادة. */
export interface PdfPatientRevision {
  /**
   * يقرأ المراجعة بعد قفل المراجع وقبل قفل الفاتورة.
   * @param tx المعاملة المحروسة
   * @param clinicId العيادة الموثوقة
   * @param patientId المراجع
   * @returns المراجعة أو null
   */
  read(tx: Tx, clinicId: string, patientId: string): Promise<string | null>;
}

/** مراجعات العيادة والفرع دون قراءة بيانات المراجع. */
export interface PdfHeaderRevisions {
  /**
   * يقفل الفرع ثم العيادة لمنع تغير العرض أثناء القبول.
   * @param tx المعاملة المحروسة
   * @param clinicId العيادة الموثوقة
   * @param branchId فرع الفاتورة
   * @returns المراجعتان أو null
   */
  read(
    tx: Tx,
    clinicId: string,
    branchId: string,
  ): Promise<{ clinic: string; branch: string } | null>;
}
