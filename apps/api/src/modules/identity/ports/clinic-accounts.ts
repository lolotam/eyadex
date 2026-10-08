import type { AuthArea } from "@eyadex/auth";

/**
 * حسابات منطقة العيادة اللي قبول الدعوة محتاجها. `EyadexAuth` بتاع منطقة العيادة بينفّذها كما هي؛
 * الـ test بيلفّها عشان يحقن فشل بعد إنشاء الحساب.
 */
export interface ClinicAccounts {
  /**
   * الحساب اللي شايل الإيميل في أي منطقة.
   *
   * @param email الإيميل
   * @returns الـ id والمنطقة، أو `null`
   */
  findAccountByEmail(email: string): Promise<{ userId: string; area: AuthArea } | null>;
  /**
   * حساب جديد في منطقة العيادة (Better Auth بيعمل الـ hash).
   *
   * @param account الإيميل والاسم وكلمة المرور
   * @returns الـ id
   */
  createUserAccount(account: {
    email: string;
    name: string;
    password: string;
  }): Promise<{ userId: string }>;
  /**
   * كلمة مرور جديدة لحساب موجود في منطقة العيادة.
   *
   * @param userId المستخدم
   * @param password كلمة المرور
   * @returns بيخلص لما تتحفظ
   */
  setAccountPassword(userId: string, password: string): Promise<void>;
}

/**
 * نفس العمليات على instance منطقة المنصة (ADR-0020): قبول دعوة فريق المنصة بيعمل حساب في المنطقة دي
 * بس، أو بيعيد استخدام حساب منصة سابه فشل سابق لنفس الرابط.
 */
export type PlatformAuthAccounts = ClinicAccounts;
