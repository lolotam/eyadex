import type { IdGenerator } from "@eyadex/ids";

/** المنطقتين اللي ليهم جلسات منفصلة (PRD §4.15). */
export type AuthArea = "platform" | "clinic";

/** خيارات الـ factory. كل قيمة سرية جاية من الـ env، ومفيش default ليها. */
export interface CreateAuthOptions {
  /** منطقة الجلسة: `platform` أو `clinic` — كل واحدة ليها اسم cookie مختلف. */
  readonly area: AuthArea;
  /** رابط الداتابيز على الدور `eyadex_auth` بس (PRD §4.5). */
  readonly databaseUrl: string;
  /** `BETTER_AUTH_SECRET`: بيوقّع الـ cookies وبيشفّر سر الـ TOTP. 32 حرف على الأقل. */
  readonly secret: string;
  /** الـ origin بتاع المنطقة (مثلاً `https://app.eyadex.com`). */
  readonly baseUrl: string;
  /** مولّد UUID v7 من `@eyadex/ids`. */
  readonly ids: IdGenerator;
  /** المسار اللي المتصفح شايفه للـ auth (افتراضياً `/api/auth`، same-origin — ADR-0004). */
  readonly basePath?: string;
  /** حجم الـ pool، افتراضياً 5. */
  readonly maxConnections?: number;
  /** بادئة cookies البيئة (`AUTH_COOKIE_PREFIX`)، افتراضياً `eyadex` — ADR-0021. */
  readonly cookiePrefix?: string;
}

/**
 * حدود طول كلمة المرور. TODO(spec): الـ PRD مابيحددش سياسة كلمة المرور؛ دي قيم Better Auth
 * الافتراضية لحد ما تتقرر.
 */
export const PASSWORD_LIMITS = { min: 8, max: 128 } as const;

/** أقل طول للسر — Better Auth بيوقّع ويشفّر بيه. */
export const MIN_SECRET_LENGTH = 32;

const AREAS: readonly string[] = ["platform", "clinic"];

/** بادئة الـ cookies لو البيئة ماحددتش غيرها: أسماء الإنتاج تفضل `eyadex-<area>` (ADR-0021). */
export const DEFAULT_COOKIE_PREFIX = "eyadex";

// Lowercase words joined by single hyphens: Better Auth appends `.<cookie>` and https adds
// `__Secure-` in front, so a dot, a space or an uppercase letter would not read back the same way.
const COOKIE_PREFIX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const MAX_COOKIE_PREFIX = 32;

/**
 * بادئة الـ cookies لمنطقة في بيئة: `eyadex-clinic` في الإنتاج، و`eyadex-staging-clinic` لو بادئة
 * البيئة `eyadex-staging`. كل بيئة ليها أسماء cookies مختلفة، فجلسة بيئة مابتتقريش في التانية.
 *
 * @param prefix بادئة البيئة (`AUTH_COOKIE_PREFIX`)، أو `undefined` للافتراضي
 * @param area المنطقة
 * @returns البادئة اللي Better Auth بيحطها قبل `.session_token`
 */
export function areaCookiePrefix(prefix: string | undefined, area: AuthArea): string {
  const base = prefix ?? DEFAULT_COOKIE_PREFIX;
  if (base.length > MAX_COOKIE_PREFIX || !COOKIE_PREFIX.test(base)) {
    throw new TypeError("cookiePrefix must be lowercase words joined by hyphens");
  }
  return `${base}-${area}`;
}

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
 * @param options.cookiePrefix بادئة cookies البيئة (اختياري)
 * @returns مفيش — بيرمي `TypeError` لو حاجة غلط
 */
export function assertOptions(options: {
  area: string;
  databaseUrl: string;
  secret: string;
  baseUrl: string;
  cookiePrefix?: string;
}): void {
  if (!AREAS.includes(options.area)) throw new TypeError("area must be platform or clinic");
  areaCookiePrefix(options.cookiePrefix, options.area as AuthArea);
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
