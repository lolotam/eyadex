/** اللي الـ dispatcher محتاجه عن الدعوة وقت الإرسال — مفيش اسم ولا إيميل ولا دور. */
export interface InvitationState {
  readonly status: "pending" | "accepted" | "cancelled";
  readonly expiresAt: Date;
  /** sha256 hex للرمز الحالي؛ resend أو نسخ الرابط بيغيّره. */
  readonly tokenHash: string;
  /** المنطقة الزمنية للعيادة، عشان تاريخ الانتهاء يتكتب بوقتها. */
  readonly timezone: string;
}

/**
 * بيقرا حالة الدعوة تحت سياق العيادة بتاعتها (`eyadex_app` + `withTenant`، ADR-0013) — الـ dispatcher
 * نفسه مالوش grant على `invitations`.
 */
export interface InvitationStateReader {
  /**
   * بيقرا الحالة وبيمسك صف الدعوة (`FOR SHARE`) لحد ما `use` يخلص، فأي resend أو نسخ رابط أو إلغاء
   * أو قبول بيستنى الإرسال، وما يقدرش يغيّر الدعوة بين الفحص والإرسال (ADR-0013).
   *
   * @param clinicId عيادة الحدث
   * @param invitationId الدعوة
   * @param use بياخد الحالة (أو `null` لو مش موجودة في العيادة دي) وبيقرر ويبعت والصف ممسوك
   * @returns اللي `use` رجّعه
   */
  whileLocked<T>(
    clinicId: string,
    invitationId: string,
    use: (state: InvitationState | null) => Promise<T>,
  ): Promise<T>;
}
