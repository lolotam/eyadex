/** المنطقتين اللي ليهم جلسات منفصلة (PRD §4.15). */
export type AuthArea = "platform" | "clinic";

/**
 * حدود طول كلمة المرور. TODO(spec): الـ PRD مابيحددش سياسة كلمة المرور؛ دي قيم Better Auth
 * الافتراضية لحد ما تتقرر.
 */
export const PASSWORD_LIMITS = { min: 8, max: 128 } as const;

/** أقل طول للسر — Better Auth بيوقّع ويشفّر بيه. */
export const MIN_SECRET_LENGTH = 32;

const AREAS: readonly string[] = ["platform", "clinic"];

/**
 * The only query parameters a database URL may carry. postgres.js copies every parameter it does not
 * recognise into the startup message, after `user`: `?user=eyadex_owner` would log in as the owner
 * while the username before `@` still reads eyadex_auth.
 */
const ALLOWED_URL_PARAMS: readonly string[] = ["sslmode"];

/**
 * بيتأكد من الخيارات قبل ما أي pool يتفتح. الرسالة بتسمّي الخيار ومابتطبعش قيمته أبداً.
 *
 * @param options الخيارات الخام
 * @param options.area المنطقة
 * @param options.databaseUrl رابط `eyadex_auth`
 * @param options.secret `BETTER_AUTH_SECRET`
 * @param options.baseUrl الـ origin بتاع المنطقة
 * @returns مفيش — بيرمي `TypeError` لو حاجة غلط
 */
export function assertOptions(options: {
  area: string;
  databaseUrl: string;
  secret: string;
  baseUrl: string;
}): void {
  if (!AREAS.includes(options.area)) throw new TypeError("area must be platform or clinic");
  if (options.secret.length < MIN_SECRET_LENGTH) {
    throw new TypeError(`secret must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  // The .env.example placeholder is long enough to pass the length check; a copied example would
  // sign cookies and encrypt every TOTP secret with a public value.
  if (options.secret.trim().toLowerCase().startsWith("change-me")) {
    throw new TypeError("secret is still the .env.example placeholder");
  }
  let base: URL;
  try {
    base = new URL(options.baseUrl);
  } catch {
    throw new TypeError("baseUrl must be an absolute URL");
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    throw new TypeError("baseUrl must be http or https");
  }
  let database: URL;
  try {
    database = new URL(options.databaseUrl);
  } catch {
    throw new TypeError("databaseUrl must be a postgres URL");
  }
  // Better Auth runs on eyadex_auth only — never the owner, never eyadex_app (PRD §4.5).
  if (decodeURIComponent(database.username) !== "eyadex_auth") {
    throw new TypeError("databaseUrl must connect as eyadex_auth");
  }
  for (const key of database.searchParams.keys()) {
    if (!ALLOWED_URL_PARAMS.includes(key)) {
      throw new TypeError(`databaseUrl may not carry the "${key}" parameter`);
    }
  }
}

/**
 * بيرفض كلمة مرور برا `PASSWORD_LIMITS` قبل أي hash.
 *
 * @param password كلمة المرور
 * @returns مفيش
 */
export function assertPassword(password: string): void {
  if (password.length < PASSWORD_LIMITS.min || password.length > PASSWORD_LIMITS.max) {
    throw new RangeError(
      `password must be ${PASSWORD_LIMITS.min}–${PASSWORD_LIMITS.max} characters`,
    );
  }
}
