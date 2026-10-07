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
   * @param clinicId عيادة الحدث
   * @param invitationId الدعوة
   * @returns حالتها، أو `null` لو مش موجودة في العيادة دي
   */
  read(clinicId: string, invitationId: string): Promise<InvitationState | null>;
}
