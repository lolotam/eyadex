import type { AuthArea } from "@eyadex/auth";

/** origin كل منطقة، والعدد اللي بنثق فيه من الـ proxies (ADR-0004). */
export interface AreaHostsOptions {
  readonly appUrl: string;
  readonly platformUrl: string;
  readonly trustProxyHops: number;
}

type RawHeaders = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/**
 * بيحوّل قيمة Host لـ host مطبّع حسب بروتوكول الـ origin (`URL` بيصغّر الحروف وبيشيل البورت
 * الافتراضي). أي قيمة فيها path أو userinfo أو مش host صالح بترجع `null`.
 *
 * @param raw قيمة الـ Host زي ما وصلت
 * @param protocol بروتوكول الـ origin اللي بنقارن بيه
 * @returns الـ host المطبّع أو `null`
 */
function normalizeHost(raw: string, protocol: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "" || /[/\\@?#\s]/.test(trimmed)) return null;
  try {
    return new URL(`${protocol}//${trimmed}`).host;
  } catch {
    return null;
  }
}

/** بيحدد المنطقة من الـ Host بمطابقة كاملة — مفيش wildcard ولا suffix. */
export class AreaHosts {
  private readonly origins: Readonly<Record<AuthArea, URL>>;
  private readonly trustProxyHops: number;

  constructor(options: AreaHostsOptions) {
    const clinic = new URL(options.appUrl);
    const platform = new URL(options.platformUrl);
    for (const url of [clinic, platform]) {
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new TypeError("APP_URL and PLATFORM_URL must be http or https");
      }
    }
    if (clinic.host === platform.host) {
      throw new TypeError("APP_URL and PLATFORM_URL must use distinct hosts");
    }
    if (!Number.isInteger(options.trustProxyHops) || options.trustProxyHops < 0) {
      throw new TypeError("TRUST_PROXY_HOPS must be a non-negative integer");
    }
    this.origins = { clinic, platform };
    this.trustProxyHops = options.trustProxyHops;
  }

  /**
   * الـ origin بتاع المنطقة (اللي Better Auth بيستخدمه كـ baseURL و trustedOrigins).
   *
   * @param area المنطقة
   * @returns الـ origin
   */
  origin(area: AuthArea): string {
    return this.origins[area].origin;
  }

  /**
   * المنطقة من headers الطلب. `X-Forwarded-Host` بيتقرا بس لو `TRUST_PROXY_HOPS > 0`، ووقتها بناخد
   * القيمة اللي الـ proxy بتاعنا حطّها (العدّ من اليمين)، مش اللي العميل بعتها.
   *
   * @param headers headers الطلب الخام
   * @returns `clinic` أو `platform`، أو `null` لأي host تاني
   */
  resolve(headers: RawHeaders): AuthArea | null {
    const raw = this.hostOf(headers);
    if (raw === undefined) return null;
    for (const area of ["clinic", "platform"] as const) {
      const url = this.origins[area];
      if (normalizeHost(raw, url.protocol) === url.host) return area;
    }
    return null;
  }

  private hostOf(headers: RawHeaders): string | undefined {
    if (this.trustProxyHops === 0) return first(headers["host"]);
    const forwarded = headers["x-forwarded-host"];
    const list = (Array.isArray(forwarded) ? forwarded.join(",") : (forwarded ?? ""))
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    // Fewer entries than trusted hops: the chain is not what we deployed, so nothing is trusted.
    if (list.length < this.trustProxyHops) return undefined;
    return list[list.length - this.trustProxyHops];
  }
}
