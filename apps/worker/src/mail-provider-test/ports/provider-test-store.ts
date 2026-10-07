/** صف مزود العيادة زي ما الـ worker محتاجه للتجربة. `sealedCredentials` لسه مقفول. */
export interface ProviderUnderTest {
  readonly id: string;
  readonly kind: "resend" | "smtp";
  readonly fromName: string;
  readonly fromEmail: string;
  readonly replyTo: string | null;
  readonly smtpHost: string | null;
  readonly smtpPort: number | null;
  readonly smtpUser: string | null;
  readonly sealedCredentials: string;
  readonly version: number;
}

/** اللي اتلقى وقت القفل: الصف (أو `null` لو اتشال) وإيميل عضوية الفاعل (أو `null`). */
export interface ProviderTestState {
  readonly provider: ProviderUnderTest | null;
  readonly recipient: string | null;
}

/** نتيجة التجربة اللي بتتكتب على الصف: نجاح بوقته، أو كود خطأ قصير (≤ 120 حرف). */
export type ProviderTestRecord =
  { readonly ok: true; readonly at: Date } | { readonly ok: false; readonly error: string };

/**
 * منفذ التجربة: كل حاجة جوه transaction واحدة تحت `withTenant(clinicId)` على `eyadex_app`.
 */
export interface ProviderTestStore {
  /**
   * بيقفل صف المزود (`FOR UPDATE`) ويقرا إيميل عضوية الفاعل النشطة، ويشغّل `use`. لو `use` رجّع
   * نتيجة بتتكتب في نفس الـ transaction؛ `null` = تخطّي من غير كتابة.
   *
   * @param clinicId العيادة
   * @param providerId صف المزود
   * @param actorUserId الأدمن اللي طلب التجربة (الرسالة بتروح لإيميله هو بس)
   * @param use الإرسال
   * @returns بيخلص بعد الـ commit
   */
  withProvider(
    clinicId: string,
    providerId: string,
    actorUserId: string,
    use: (state: ProviderTestState) => Promise<ProviderTestRecord | null>,
  ): Promise<void>;
}
