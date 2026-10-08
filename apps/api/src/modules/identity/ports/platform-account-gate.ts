/**
 * الخطوة اللي بعد TOTP في `@PlatformStaff` (ADR-0020): المستخدم لازم يكون مربوط بحساب نشط في
 * فريق المنصة. بيتقري في كل طلب (مفيش كاش)، فالتعطيل بيسري على الطلب اللي بعده.
 */
export interface PlatformAccountGate {
  /**
   * هل مستخدم Better Auth ده عضو نشط في فريق المنصة؟
   *
   * @param userId مستخدم الجلسة
   * @returns `true` لو فيه صف مربوط بيه وحالته `active`
   */
  isActive(userId: string): Promise<boolean>;
}

/** Token الـ DI. من غيره كل routes المنصة بترجع 500 (مقفول، مش مفتوح). */
export const PLATFORM_ACCOUNT_GATE = Symbol("identity.PlatformAccountGate");
