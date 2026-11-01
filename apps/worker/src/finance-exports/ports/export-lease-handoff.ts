/** هوية التأجير بس. مفيش تقرير ولا مفتاح ولا بايتات. */
export interface LeasedExportIdentity {
  readonly clinicId: string;
  readonly exportId: string;
  readonly attempt: number;
  readonly leaseOwner: string;
}

/**
 * ذاكرة ضيقة للـ runner اللاحق. الالتقاط يسجّل الهوية بعد الالتزام ولا يبني.
 */
export interface ExportLeaseHandoff {
  /**
   * يسجّل محاولة اتأجّرت في معاملة التطبيق.
   *
   * @param identity العيادة والتصدير والمحاولة والمالك
   * @returns من غير قيمة؛ يسجّل الهوية بس ولا يبني التقرير
   */
  record(identity: LeasedExportIdentity): void;
}
