/** اللي الـ dispatcher محتاجه عن الدعوة وقت الإرسال — مفيش اسم ولا إيميل ولا دور. */
export interface InvitationState {
  readonly status: "pending" | "accepted" | "cancelled";
  readonly expiresAt: Date;
  /** sha256 hex للرمز الحالي؛ resend أو نسخ الرابط بيغيّره. */
  readonly tokenHash: string;
  /**
   * الدعوة على كل الفروع، أو لسه ليها فرع نشط واحد على الأقل. `false` معناه إن فروعها كلها اتعطّلت
   * والإلغاء التلقائي (ADR-0013 §12) لسه ما وصلهاش.
   */
  readonly hasActiveBranch: boolean;
  /** المنطقة الزمنية للعيادة، عشان تاريخ الانتهاء يتكتب بوقتها. */
  readonly timezone: string;
  /** اللي بعت الدعوة: فاعل سطر التحويل في السجل (مفيش فاعل نظام، نفس `invitation.auto_cancelled`). */
  readonly invitedByUserId: string;
  /** صف مزود العيادة ممسوك `FOR UPDATE`، لو اتطلب وموجود. */
  readonly clinicProvider: LockedClinicProvider | null;
}

/** صف مزود العيادة وقت الإرسال. `sealedCredentials` لسه مقفول. */
export interface ClinicProviderRow {
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
  readonly verifiedAt: Date | null;
  readonly degradedAt: Date | null;
  readonly consecutiveFailures: number;
}

/** نتيجة إرسال عبر مزود العيادة اللي بتتكتب على الصف. الغامض مابيتكتبش. */
export type ClinicSendOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string; readonly definitive: boolean; readonly at: Date };

/** صف المزود والصف ممسوك، وطريقة تسجيل النتيجة في نفس الـ transaction. */
export interface LockedClinicProvider {
  readonly row: ClinicProviderRow;
  /**
   * بيكتب النتيجة (ADR-0014، 7c-2b): النجاح بيصفّر العداد؛ الفشل الأكيد بيزوّده، وعند 3 بيحط
   * `degraded_at` و`last_error` وسطر سجل واحد `clinic.mail_provider_degraded`.
   *
   * @param outcome نتيجة الإرسال
   * @returns `true` لو المزود اتحوّل للمنصة دلوقتي
   */
  record(outcome: ClinicSendOutcome): Promise<boolean>;
}

/** اختيارات القراءة. */
export interface LockOptions {
  /** يقرا صف مزود العيادة (`FOR UPDATE`) بعد صف الدعوة وفروعها — لدعوة المستخدم بس. */
  readonly clinicProvider?: boolean;
}

/**
 * بيقرا حالة الدعوة تحت سياق العيادة بتاعتها (`eyadex_app` + `withTenant`، ADR-0013) — الـ dispatcher
 * نفسه مالوش grant على `invitations`.
 */
export interface InvitationStateReader {
  /**
   * بيقرا الحالة وبيمسك صف الدعوة (`FOR SHARE`) لحد ما `use` يخلص، فأي resend أو نسخ رابط أو إلغاء
   * أو قبول بيستنى الإرسال، وما يقدرش يغيّر الدعوة بين الفحص والإرسال (ADR-0013). صفوف فروع الدعوة
   * بتتمسك `FOR SHARE` كمان، فتعطيل فرع منهم بيستنى الإرسال برضه.
   *
   * @param clinicId عيادة الحدث
   * @param invitationId الدعوة
   * @param use بياخد الحالة (أو `null` لو مش موجودة في العيادة دي) وبيقرر ويبعت والصف ممسوك
   * @param options هل نقرا صف مزود العيادة كمان
   * @returns اللي `use` رجّعه
   */
  whileLocked<T>(
    clinicId: string,
    invitationId: string,
    use: (state: InvitationState | null) => Promise<T>,
    options?: LockOptions,
  ): Promise<T>;
}
