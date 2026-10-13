/** بيانات Meta تستخدم على حد الشبكة فقط ولا تدخل الرد أو السجل. */
export interface MetaCredentials {
  readonly accessToken: string;
  readonly phoneNumberId: string;
  readonly businessAccountId: string;
}

/** منفذ التحقق من coexistence على Graph v22.0، مستقل عن Evolution. */
export interface MetaApi {
  /**
   * يتحقق من رقم الهاتف ثم يشترك بتطبيق Meta؛ لا يستدعي register.
   * @param credentials البيانات المفتوحة في الذاكرة
   * @returns آخر أربع خانات من رقم الهاتف
   */
  verify(credentials: MetaCredentials): Promise<string>;
}
