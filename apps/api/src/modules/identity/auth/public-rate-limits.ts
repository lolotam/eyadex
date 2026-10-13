import { createHash } from "node:crypto";

import type { Limit, RateRule } from "./rate-limiter.ts";

const MINUTE = 60_000;

// TODO(spec): starting values (ADR-0008), like ADR-0005's; the owner confirms them.
export const PUBLIC_LIMITS = {
  invitationPerIp: { max: 30, windowMs: 10 * MINUTE },
  invitationPerToken: { max: 10, windowMs: 15 * MINUTE },
} as const satisfies Record<string, Limit>;

/** What a sessionless /v1 route is counted on, before any database work. */
interface PublicRouteRules {
  readonly ip: Limit;
  /** Counted per hash of `body.token` when the route carries one. */
  readonly token?: Limit;
}

/**
 * Every /v1 POST route reachable WITHOUT a session, keyed `METHOD /v1/path`. A route missing here is
 * refused by `PublicRateLimitGuard` (fail closed), and the completeness test walks the controllers.
 */
export const PUBLIC_V1_ROUTES: Readonly<Record<string, PublicRouteRules>> = {
  "POST /v1/hooks/evolution": { ip: { max: 600, windowMs: MINUTE } },
  "POST /v1/invitations/inspect": { ip: PUBLIC_LIMITS.invitationPerIp },
  "POST /v1/invitations/accept": {
    ip: PUBLIC_LIMITS.invitationPerIp,
    token: PUBLIC_LIMITS.invitationPerToken,
  },
  // ADR-0020: the platform team's invitation, on the platform host, with the same starting values.
  "POST /v1/platform/invitations/inspect": { ip: PUBLIC_LIMITS.invitationPerIp },
  "POST /v1/platform/invitations/accept": {
    ip: PUBLIC_LIMITS.invitationPerIp,
    token: PUBLIC_LIMITS.invitationPerToken,
  },
};

/**
 * الأبعاد اللي بتتعد على طلب لـ route عام. الـ IP الأول (قليل التنوع)، وبعده الـ hash بتاع الرمز —
 * الرمز نفسه مابيتعدّش ولا بيوصل Redis (الـ limiter بيعمل HMAC للقيمة كمان).
 *
 * @param routeKey `METHOD /v1/path`
 * @param ip العنوان من `AreaHosts.clientIp` بس
 * @param body الجسم قبل الـ contract
 * @returns الأبعاد، أو `null` لو الـ route مش في القايمة
 */
export function publicRulesFor(
  routeKey: string,
  ip: string | undefined,
  body: unknown,
): RateRule[] | null {
  const rules = PUBLIC_V1_ROUTES[routeKey];
  if (rules === undefined) return null;
  const route = routeKey.slice(routeKey.indexOf("/v1/") + 4).replaceAll("/", "-");
  const out: RateRule[] = [{ route, dimension: "ip", value: ip ?? "untrusted", limit: rules.ip }];
  const token = (body as { token?: unknown } | null | undefined)?.token;
  if (rules.token !== undefined && typeof token === "string" && token !== "") {
    const hash = createHash("sha256").update(token, "utf8").digest("hex");
    out.push({ route, dimension: "token", value: hash, limit: rules.token });
  }
  return out;
}
