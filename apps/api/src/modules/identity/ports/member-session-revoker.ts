/**
 * تعطيل عضوية (slice 7) لازم ينهي جلساتها فورًا، مش بس يرفض الطلب الجاي (PRD §4.10). الـ guard
 * بيرفض العضوية المتعطلة على أي حال؛ ده بيمسح الجلسات نفسها كمان.
 */
export interface MemberSessionRevoker {
  /**
   * بيلغي كل جلسات حساب العيادة ده.
   *
   * @param userId id حساب Better Auth
   * @returns بيخلص بعد الإلغاء
   */
  revokeMemberSessions(userId: string): Promise<void>;
}

/** Token الـ DI. */
export const MEMBER_SESSION_REVOKER = Symbol("identity.MemberSessionRevoker");
