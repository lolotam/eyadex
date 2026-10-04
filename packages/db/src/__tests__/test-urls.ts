/**
 * روابط اختبارات الداتابيز. job الـ verify في CI بيشغّل `pnpm test` ومالوش داتابيز خالص، فلو المتغير
 * ناقص لازم الفشل يبقى صريح — `test:db` يوقع فوراً ما يبلمّغش إن كل حاجة عدّت وهو مش شغّال.
 */
export interface TestUrls {
  readonly ownerUrl: string;
  readonly appUrl: string;
  readonly platformUrl: string;
}

const OWNER = "EYADEX_TEST_OWNER_URL";
const APP = "EYADEX_TEST_APP_URL";
const PLATFORM = "EYADEX_TEST_PLATFORM_URL";

/** بيرمي استثناء باسم المتغير الناقص، وما بيرجعش أبداً */
const missing = (name: string): never => {
  throw new Error(
    `${name} is not set — @eyadex/db test:db needs the owner, eyadex_app and eyadex_platform URLs`,
  );
};

/**
 * بيقرا التلاتة من الـ environment وبيعترم أي واحد ناقص. مفيش fallback ولا skip صامت: أول متغير
 * ناقص بيوقّف التشغيل برسالة بتسمّيه.
 *
 * @returns الروابط التلاتة
 */
export function requireTestUrls(): TestUrls {
  return {
    ownerUrl: process.env[OWNER] ?? missing(OWNER),
    appUrl: process.env[APP] ?? missing(APP),
    platformUrl: process.env[PLATFORM] ?? missing(PLATFORM),
  };
}
