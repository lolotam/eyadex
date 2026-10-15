import { createHash } from "node:crypto";

import type { Limit, RateRule } from "./rate-limiter.ts";

const MINUTE = 60_000;

// TODO(spec): starting values (ADR-0008), like ADR-0005's; the owner confirms them.
export const PUBLIC_LIMITS = {
  invitationPerIp: { max: 30, windowMs: 10 * MINUTE },
  invitationPerToken: { max: 10, windowMs: 15 * MINUTE },
  invoiceLinkPerIp: { max: 60, windowMs: 10 * MINUTE },
  invoiceLinkPerTokenPrefix: { max: 30, windowMs: 10 * MINUTE },
} as const satisfies Record<string, Limit>;

/** What a sessionless /v1 route is counted on, before any database work. */
interface PublicRouteRules {
  readonly ip: Limit;
  /** Counted per hash of `body.token` when the route carries one. */
  readonly token?: Limit;
  /** Counted per hash of the first characters of the `:token` path parameter (spec R2-7). */
  readonly tokenPrefix?: Limit;
}

const TOKEN_PREFIX_LENGTH = 8;

/**
 * Every /v1 route reachable WITHOUT a session (the POSTs, Meta's webhook check and the patient's invoice
 * link), keyed `METHOD /v1/path`. A route missing here is
 * refused by `PublicRateLimitGuard` (fail closed), and the completeness test walks the controllers.
 */
export const PUBLIC_V1_ROUTES: Readonly<Record<string, PublicRouteRules>> = {
  "POST /v1/hooks/evolution": { ip: { max: 600, windowMs: MINUTE } },
  // Meta's app webhook (spec §7.2): status bursts from Meta's servers, and its rare subscription check.
  "POST /v1/hooks/meta": { ip: { max: 1200, windowMs: MINUTE } },
  "GET /v1/hooks/meta": { ip: { max: 30, windowMs: MINUTE } },
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
  // Finance F1 (spec §8 rule 16, R2-7): the patient's private invoice link, on the clinic host.
  "GET /v1/public/invoices/:token": {
    ip: PUBLIC_LIMITS.invoiceLinkPerIp,
    tokenPrefix: PUBLIC_LIMITS.invoiceLinkPerTokenPrefix,
  },
};

const hashOf = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/**
 * الأبعاد اللي بتتعد على طلب لـ route عام. الـ IP الأول (قليل التنوع)، وبعده الـ hash بتاع الرمز —
 * الرمز نفسه مابيتعدّش ولا بيوصل Redis (الـ limiter بيعمل HMAC للقيمة كمان).
 *
 * @param routeKey `METHOD /v1/path`
 * @param ip العنوان من `AreaHosts.clientIp` بس
 * @param body الجسم قبل الـ contract
 * @param params معاملات المسار (`:token`)
 * @returns الأبعاد، أو `null` لو الـ route مش في القايمة
 */
export function publicRulesFor(
  routeKey: string,
  ip: string | undefined,
  body: unknown,
  params?: unknown,
): RateRule[] | null {
  const rules = PUBLIC_V1_ROUTES[routeKey];
  if (rules === undefined) return null;
  const route = routeKey.slice(routeKey.indexOf("/v1/") + 4).replaceAll("/", "-");
  const out: RateRule[] = [{ route, dimension: "ip", value: ip ?? "untrusted", limit: rules.ip }];
  const token = (body as { token?: unknown } | null | undefined)?.token;
  if (rules.token !== undefined && typeof token === "string" && token !== "") {
    out.push({ route, dimension: "token", value: hashOf(token), limit: rules.token });
  }
  const pathToken = (params as { token?: unknown } | null | undefined)?.token;
  if (rules.tokenPrefix !== undefined && typeof pathToken === "string" && pathToken !== "") {
    const prefix = hashOf(pathToken.slice(0, TOKEN_PREFIX_LENGTH));
    out.push({ route, dimension: "token_prefix", value: prefix, limit: rules.tokenPrefix });
  }
  return out;
}
