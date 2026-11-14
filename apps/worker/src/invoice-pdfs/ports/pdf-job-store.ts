import type { PdfFailureCode } from "../domain/pdf-job-failure.ts";

/** سياج محاولة PDF الكامل: العيادة والمهمة والمحاولة والعدّاد ورمز التأجير. */
export interface PdfJobFence {
  readonly clinicId: string;
  readonly jobId: string;
  readonly attempt: number;
  readonly fence: bigint;
  readonly leaseToken: string;
}

/** مهمة PDF مؤجرة مع هوية الفاتورة ومراجعة التوليد وموعدي التأجير والمهلة. */
export interface LeasedPdfJob extends PdfJobFence {
  readonly invoiceId: string;
  readonly invoiceVersion: number;
  readonly renderRevision: string;
  readonly leaseUntil: Date;
  readonly deadlineAt: Date;
}

/** نتيجة الالتقاط: مهمة مؤجرة أو لا توجد مهمة مستحقة. */
export type PdfClaim = { kind: "claimed"; job: LeasedPdfJob } | { kind: "empty" };

/** نتيجة الكتابة المسيّجة: طُبّقت، أو نجحت المحاولة نفسها، أو ضاع التأجير. */
export type PdfFenceAnswer = { kind: "applied" | "own_success" | "lost_lease" };

/** عقد مخزن مهام PDF المؤجرة داخل نطاق العيادة. */
export interface PdfJobStore {
  /**
   * يلتقط أقدم مهمة PDF مستحقة للعيادة ويعيد تأجيرها المسيّج.
   *
   * @param clinicId معرّف العيادة مالكة المهمة
   * @returns المهمة المؤجرة، أو إجابة فارغة عند غياب مهمة مستحقة
   */
  claimNext(clinicId: string): Promise<PdfClaim>;

  /**
   * يمدّد تأجير محاولة PDF ما دام السياج الكامل والمهلة ما زالا صالحين.
   *
   * @param fence سياج المحاولة الكامل
   * @returns نتيجة التمديد أو حالة التأجير بعد إعادة القراءة
   */
  heartbeat(fence: PdfJobFence): Promise<PdfFenceAnswer>;

  /**
   * يسجّل فشلًا عامًا لمحاولة PDF بشرط تطابق السياج الكامل.
   *
   * @param fence سياج المحاولة الكامل
   * @param code رمز الفشل العام من الكتالوج
   * @returns نتيجة التسجيل أو حالة التأجير بعد إعادة القراءة
   */
  recordFailure(fence: PdfJobFence, code: PdfFailureCode): Promise<PdfFenceAnswer>;
}
