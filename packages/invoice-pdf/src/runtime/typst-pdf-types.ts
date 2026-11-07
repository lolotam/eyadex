/** مسارات نشر موثوقة لا تأتي من النموذج أو الطلب. */
export interface TypstPdfRuntimePaths {
  readonly script: string;
  readonly typst: string;
  readonly qpdf: string;
  readonly fonts: string;
  readonly root: string;
}

/** شعار جهزه التطبيق؛ تنتقل ملكيته للمصير عند إرجاعه مرة واحدة. */
export interface PreparedPdfLogo {
  readonly root: string;
  readonly name: string;
  /** يحذف موارد الشعار؛ يستدعيه المالك مرة واحدة فقط. */
  readonly dispose: () => Promise<void>;
}

/** يحضر شعارا مستقلا بعد قبول الطلب؛ التطبيق يتحقق من محتواه ومساراته. */
export type PreparePdfLogo = () => Promise<PreparedPdfLogo | null | undefined>;
