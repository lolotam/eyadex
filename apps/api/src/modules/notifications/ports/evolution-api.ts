/** How an Evolution instance links the clinic's number (spec §7.1, N-6). */
export type EvolutionIntegration =
  | { readonly kind: "baileys" }
  | {
      readonly kind: "business";
      /** Meta's access token; travels only in the create request body. */
      readonly accessToken: string;
      readonly phoneNumberId: string;
      readonly businessAccountId: string;
    };

/** What `instance/connect` answered: linked, a QR to scan (maybe not generated yet), or no instance. */
export type EvolutionConnectResult =
  | { readonly state: "open" }
  | { readonly state: "pending"; readonly qrDataUrl: string | null }
  | { readonly state: "missing" };

/** `instance/connectionState`, with an unknown instance as `missing`. */
export type EvolutionConnectionState = "open" | "connecting" | "close" | "missing";

/**
 * منفذ Evolution API (N-7، spec §7.1): السيرفر اللي بيربط رقم العيادة بواتساب. التنفيذ HTTP على الشبكة
 * الداخلية بمهلة 5 ثواني؛ مفتاح الـ API والـ QR ورقم الموبايل عمرهم ما بيتسجلوا. الرقم الكامل ما بيعدّيش
 * من هنا أبداً: آخر 4 أرقام بس.
 */
export interface EvolutionApi {
  /** `false` لما `EVOLUTION_API_URL` و `EVOLUTION_API_KEY` مش متظبطين: الربط بيرد 503 والإرسال بيتخطى. */
  readonly configured: boolean;

  /**
   * بيعمل instance للعيادة. لو الاسم موجود بالفعل على Evolution يبقى `exists` (مش خطأ).
   *
   * @param instanceName `eyadex-<clinic id>`
   * @param integration Baileys (QR) أو Business (coexistence)
   * @returns `created` أو `exists`
   */
  createInstance(
    instanceName: string,
    integration: EvolutionIntegration,
  ): Promise<"created" | "exists">;

  /**
   * بيبدأ الربط أو يكمّله ويرجع الـ QR (data URL لصورة PNG)، أو `open` لو الرقم مربوط.
   *
   * @param instanceName اسم الـ instance
   * @returns الحالة والـ QR
   */
  connect(instanceName: string): Promise<EvolutionConnectResult>;

  /**
   * حالة الاتصال من غير ما يبدأ ربط جديد.
   *
   * @param instanceName اسم الـ instance
   * @returns الحالة
   */
  connectionState(instanceName: string): Promise<EvolutionConnectionState>;

  /**
   * آخر 4 أرقام من الرقم المربوط (من `ownerJid`).
   *
   * @param instanceName اسم الـ instance
   * @returns 4 أرقام، أو `null` لو مفيش رقم معروف
   */
  ownerLast4(instanceName: string): Promise<string | null>;

  /**
   * بيفك ربط الرقم؛ instance مش مربوط أو مش موجود = خلاص (مش خطأ).
   *
   * @param instanceName اسم الـ instance
   */
  logout(instanceName: string): Promise<void>;

  /**
   * بيمسح الـ instance (قبل ما نعمل واحد تاني بنفس الاسم بطريقة ربط تانية)؛ مش موجود = خلاص.
   *
   * @param instanceName اسم الـ instance
   */
  deleteInstance(instanceName: string): Promise<void>;
}
