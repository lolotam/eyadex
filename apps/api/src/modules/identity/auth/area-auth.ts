import { createAuth, type AreaSession, type AuthArea, type EyadexAuth } from "@eyadex/auth";
import type { IdGenerator } from "@eyadex/ids";

import { AreaHosts } from "./area-hosts.ts";
import type { AuthConfig } from "./auth-config.ts";

/** Token الـ DI لـ `AreaAuth`. */
export const AREA_AUTH = Symbol("identity.AreaAuth");

/** الـ instance بتاع كل منطقة، ومحدد المنطقة من الـ host. */
export interface AreaAuth {
  readonly hosts: AreaHosts;
  of(area: AuthArea): EyadexAuth;
  close(): Promise<void>;
}

/** الجلسة اللي `SessionGuard` بيحطها على الطلب. */
export interface ResolvedSession {
  readonly area: AuthArea;
  readonly session: AreaSession;
}

/**
 * هل الجلسة دي نفسها اتعملت بعد ما عامل تاني (TOTP أو backup code) اتحقق؟ (0024) — مش علم المستخدم
 * `twoFactorEnabled`: جلسة اتفتحت بكلمة المرور بس لازم تفضل ناقصة حتى لو المستخدم كمّل التسجيل بعدها.
 *
 * @param session الجلسة
 * @returns `true` بس لو الجلسة اتعملت بعامل تاني متحقق منه
 */
export function hasTwoFactor(session: AreaSession): boolean {
  return (session.session as { twoFactorVerified?: unknown }).twoFactorVerified === true;
}

/**
 * بيحوّل headers الـ Fastify لـ `Headers` بتاعة الـ Fetch API.
 *
 * @param raw headers الطلب
 * @returns `Headers`
 */
export function toHeaders(raw: Record<string, string | string[] | undefined>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  return headers;
}

/**
 * بيبني instance لكل منطقة على نفس الـ pool role (`eyadex_auth`) ونفس السر (ADR-0003).
 *
 * @param config إعدادات الـ auth
 * @param ids مولّد UUID v7
 * @returns الـ `AreaAuth`
 */
export function buildAreaAuth(config: AuthConfig, ids: IdGenerator): AreaAuth {
  const hosts = new AreaHosts({
    appUrl: config.APP_URL,
    platformUrl: config.PLATFORM_URL,
    trustProxyHops: config.TRUST_PROXY_HOPS,
  });
  const build = (area: AuthArea) =>
    createAuth({
      area,
      databaseUrl: config.AUTH_DATABASE_URL,
      secret: config.BETTER_AUTH_SECRET,
      baseUrl: hosts.origin(area),
      ids,
    });
  const instances: Record<AuthArea, EyadexAuth> = {
    clinic: build("clinic"),
    platform: build("platform"),
  };
  return {
    hosts,
    of: (area) => instances[area],
    close: async () => {
      await Promise.all([instances.clinic.close(), instances.platform.close()]);
    },
  };
}
