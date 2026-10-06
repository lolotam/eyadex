/**
 * لازم يتنده بعد الـ commit لأي تغيير في دور، صلاحياته، عضوية، فروعها، أو حالة/انتهاء العيادة
 * (slices 5–8). بيرفع نسخة كاش العيادة، فأي entry قديمة ماتتقريش تاني (RBAC-03، ADR-0009).
 */
export interface AuthorizationInvalidator {
  /**
   * بيبطّل كاش الصلاحيات وحالة العيادة لكل أعضائها.
   *
   * @param clinicId العيادة اللي اتغيّرت
   * @returns بيخلص لما النسخة تترفع (أو يرمي لو Redis واقع — الكاش وقتها مش بيتقري أصلًا)
   */
  clinicChanged(clinicId: string): Promise<void>;
}

/** Token الـ DI. */
export const AUTHORIZATION_INVALIDATOR = Symbol("identity.AuthorizationInvalidator");
