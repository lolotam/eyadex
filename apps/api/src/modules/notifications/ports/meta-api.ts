/** إصدار Graph الوحيد اللي الـ API بيكلّمه، وبيرجع للمتصفح في إعداد Embedded Signup. */
export const META_GRAPH_VERSION = "v22.0";

/** بيانات Meta تستخدم على حد الشبكة فقط ولا تدخل الرد أو السجل. */
export interface MetaCredentials {
  readonly accessToken: string;
  readonly phoneNumberId: string;
  readonly businessAccountId: string;
}

/** تطبيق Meta بتاع Eyadex (Tech Provider): الرقم عام، والسر مايسيبش الـ API. */
export interface MetaApp {
  readonly appId: string;
  readonly appSecret: string;
}

/** منفذ Graph v22.0 للـ coexistence، مستقل عن Evolution. */
export interface MetaApi {
  /**
   * يتحقق من رقم الهاتف ثم يشترك بتطبيق Meta؛ لا يستدعي register.
   * @param credentials البيانات المفتوحة في الذاكرة
   * @returns آخر أربع خانات من رقم الهاتف
   */
  verify(credentials: MetaCredentials): Promise<string>;

  /**
   * يبدّل الكود اللي رجع من `FB.login` بتوكن الـ business (N3، Embedded Signup). الرابط فيه سر التطبيق،
   * فعمره ما بيتسجل ولا بيتربط في خطأ.
   * @param code الكود اللي المتصفح بعته، مرة واحدة
   * @param app رقم التطبيق وسره
   * @returns التوكن، في الذاكرة بس لحد ما يتختم
   */
  exchangeCode(code: string, app: MetaApp): Promise<string>;
}
