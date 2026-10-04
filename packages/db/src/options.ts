/**
 * الأدوار اللي الـ runtime بيتصل بيها (PRD §4.5): `eyadex_app` للـ API والـ worker تحت الـ RLS،
 * و`eyadex_platform` لموديول المنصة. `eyadex_auth` و`eyadex_dispatcher` ليهم حزمهم الخاصة
 * (المرحلة ب) — مفيش wrapper في الباكاج ده بياخدهم، والـ owner مش من قوائمهم أصلاً.
 */
export type DatabaseRole = "eyadex_app" | "eyadex_platform";

/**
 * مولّد المعرّفات — متحقن بدل ما `withNewTenant` تعمل id بنفسها، عشان الاختبارات تبقى ثابتة
 * ولا اختيار المصدر (ساعة النظام في الإنتاج، ساعة مزروعة في الاختبار) يبقى قرار الـ caller.
 */
export interface IdGenerator {
  newId(): string;
}

/**
 * إعدادات `createDatabase` — كلها متحقنة. الباكاج ما بيقراش الـ environment ولا الـ config،
 * فالـ composition root في كل app هو اللي بيقرا وبيقرّر.
 */
export interface DatabaseOptions {
  /**
   * رابط الاتصال. بيتسلّم لـ postgres.js وبس: بيتسجل في ولا سطر ولا رسالة خطأ ولا audit
   * (القاعدة السابعة في `docs/adr/0002-database-access.md`)، وكل validation بترفض من غير ما تطبعه.
   */
  readonly url: string;
  /**
   * الدور اللي اللينك ده **لازم** يدخل بيه. كل transaction بتقارن `current_user` بالقيمة دي
   * وبترفض لو اختلفت أو لو الدور بيعدّي الـ RLS — الوينج عشان بالظبط كده.
   */
  readonly role: DatabaseRole;
  /** مولّد UUID v7 — `systemUuidV7()` من `@eyadex/ids` في الـ production، ومولّد ثابت في الاختبار. */
  readonly ids: IdGenerator;
  /** حجم الـ pool: عدد صحيح 1..100، الافتراضي 10. */
  readonly maxConnections?: number;
  /** سقف الـ transaction بالـ ms: عدد صحيح 1..600000، الافتراضي 10000. */
  readonly transactionTimeoutMs?: number;
  /**
   * سقف فتح الـ connection بالـ ثانية: عدد صحيح 1..60، الافتراضي 10. بيتبعت لـ postgres.js
   * كـ `connect_timeout`، فـ host بياكل الـ packets بيفشل خلال ثواني بدل ما الـ `ping` يفضل
   * مستني TCP لسه. مش سقف الـ transaction — ده `transactionTimeoutMs`.
   */
  readonly connectTimeoutSeconds?: number;
}

/** الإعدادات بعد التحقق منها، بالقيم الافتراضية مملوءة — الشكل الوحيد اللي بيوصل لـ postgres.js. */
export interface ResolvedDatabaseOptions {
  readonly url: string;
  readonly role: DatabaseRole;
  readonly ids: IdGenerator;
  readonly maxConnections: number;
  readonly transactionTimeoutMs: number;
  readonly connectTimeoutSeconds: number;
}

const ROLES: readonly DatabaseRole[] = ["eyadex_app", "eyadex_platform"];

const MAX_CONNECTIONS_MIN = 1;
const MAX_CONNECTIONS_MAX = 100;
const TIMEOUT_MIN_MS = 1;
const TIMEOUT_MAX_MS = 600_000;
const CONNECT_TIMEOUT_MIN_S = 1;
const CONNECT_TIMEOUT_MAX_S = 60;
const DEFAULT_MAX_CONNECTIONS = 10;
const DEFAULT_TRANSACTION_TIMEOUT_MS = 10_000;
const DEFAULT_CONNECT_TIMEOUT_S = 10;

/**
 * `pg_stat_activity` بيعرض الاسم ده بدل سطر فاضي، فتشوف عيادة ومنصة وإثنين تانيين من غير ما تقرا
 * أي صف من بيانات عيادة.
 */
export function applicationName(role: DatabaseRole): string {
  return role === "eyadex_platform" ? "eyadex-platform" : "eyadex-app";
}

const wholeNumberBetween = (value: unknown, min: number, max: number): boolean =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

/**
 * بيتحقّق من `createDatabase` كله **قبل** ما يتعمل أي اتصال: دور معروف، جذر مولّد الـ ids، و
 * حدود الأعداد. الغلط هنا TypeError برسالة بتقول الحاجة الناقصة وبس — الرابط وكلمة السر
 * موجودين في `options.url` وما بيوصلوش لأي رسالة. وكل option بيتقرا مرة واحدة، فالـ getter
 * في الـ options object ميفرقش بين قيمة اتحقّقت منها وقيمة اتسلّمت لـ postgres.js.
 *
 * @param options إعدادات الـ caller
 * @returns الإعدادات بالقيم الافتراضية مملوءة
 */
export function resolveOptions(options: DatabaseOptions): ResolvedDatabaseOptions {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("createDatabase needs an options object");
  }
  // كل option بيتقرا **مرة واحدة** جوّه local: getter أو Proxy في الـ object اللي مرّ من الـ caller
  // يقدر يعيد قيمة تانية في القراءة التانية، والـ validation كانت بتفحص قيمة وبتسلّم تانية.
  const url = options.url;
  if (typeof url !== "string" || url.trim() === "") {
    throw new TypeError("options.url must be a non-empty connection string");
  }
  const role = options.role;
  if (!ROLES.includes(role)) {
    throw new TypeError(`options.role must be ${ROLES.join(" or ")}`);
  }
  const ids = options.ids;
  if (typeof ids !== "object" || ids === null || typeof ids.newId !== "function") {
    throw new TypeError("options.ids must be an IdGenerator — an object with newId()");
  }
  const maxConnections = options.maxConnections ?? DEFAULT_MAX_CONNECTIONS;
  if (!wholeNumberBetween(maxConnections, MAX_CONNECTIONS_MIN, MAX_CONNECTIONS_MAX)) {
    throw new TypeError(
      `options.maxConnections must be a whole number between ${MAX_CONNECTIONS_MIN} and ${MAX_CONNECTIONS_MAX}`,
    );
  }
  const transactionTimeoutMs = options.transactionTimeoutMs ?? DEFAULT_TRANSACTION_TIMEOUT_MS;
  if (!wholeNumberBetween(transactionTimeoutMs, TIMEOUT_MIN_MS, TIMEOUT_MAX_MS)) {
    throw new TypeError(
      `options.transactionTimeoutMs must be a whole number between ${TIMEOUT_MIN_MS} and ${TIMEOUT_MAX_MS}`,
    );
  }
  const connectTimeoutSeconds = options.connectTimeoutSeconds ?? DEFAULT_CONNECT_TIMEOUT_S;
  if (!wholeNumberBetween(connectTimeoutSeconds, CONNECT_TIMEOUT_MIN_S, CONNECT_TIMEOUT_MAX_S)) {
    throw new TypeError(
      `options.connectTimeoutSeconds must be a whole number between ${CONNECT_TIMEOUT_MIN_S} and ${CONNECT_TIMEOUT_MAX_S}`,
    );
  }
  return { url, role, ids, maxConnections, transactionTimeoutMs, connectTimeoutSeconds };
}
