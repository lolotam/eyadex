/** بيلغي جلسات حساب منصة اتعطّل (PRD §4.10، ADR-0020)، بعد الـ commit. */
export interface PlatformSessionRevoker {
  /**
   * كل جلسات المستخدم في منطقة المنصة.
   *
   * @param userId مستخدم Better Auth
   * @returns بيخلص لما الجلسات تتمسح
   */
  revokePlatformSessions(userId: string): Promise<void>;
}

/** Token الـ DI. */
export const PLATFORM_SESSION_REVOKER = Symbol("identity.PlatformSessionRevoker");
