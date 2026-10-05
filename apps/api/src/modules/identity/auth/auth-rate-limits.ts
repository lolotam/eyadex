import type { AuthArea } from "@eyadex/auth";

import type { Limit, RateRule } from "./rate-limiter.ts";

const MINUTE = 60_000;

// TODO(spec): PRD §4.10 asks for Redis-backed limits on sign-in and recovery but gives no numbers;
// these are the ADR-0005 starting values, to be confirmed by the owner.
export const AUTH_LIMITS = {
  signInPerIp: { max: 20, windowMs: 10 * MINUTE },
  signInPerEmail: { max: 5, windowMs: 15 * MINUTE },
  secondFactorPerIp: { max: 20, windowMs: 10 * MINUTE },
  secondFactorPerSubject: { max: 5, windowMs: 5 * MINUTE },
  sensitivePerUser: { max: 5, windowMs: 15 * MINUTE },
} as const satisfies Record<string, Limit>;

/** What the handler knows about a request when it picks the counters. */
export interface RateContext {
  readonly area: AuthArea;
  readonly path: string;
  /** From `AreaHosts.clientIp` only; `undefined` when the proxy chain is not the deployed one. */
  readonly ip: string | undefined;
  readonly body: unknown;
  readonly cookieHeader: string | undefined;
  readonly userId: string | undefined;
}

const SECOND_FACTOR_PATHS = new Set(["/two-factor/verify-totp", "/two-factor/verify-backup-code"]);
// Every signed-in route that checks the current password: a stolen session must not buy unlimited
// password guesses (Better Auth's own limiter is off — ADR-0005).
const USER_PATHS = new Set([
  "/change-password",
  "/two-factor/enable",
  "/two-factor/disable",
  "/two-factor/generate-backup-codes",
]);

// One shared bucket for requests whose client address cannot be trusted: they are limited together.
const ipOf = (ip: string | undefined) => ip ?? "untrusted";
const routeOf = (path: string) => path.slice(1).replaceAll("/", "-");

function emailOf(body: unknown): string | undefined {
  if (typeof body !== "string") return undefined;
  try {
    const email = (JSON.parse(body) as { email?: unknown } | null)?.email;
    return typeof email === "string" ? email.trim().toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

/** The area's pending-sign-in cookie, with or without the `__Secure-` prefix. */
function twoFactorCookie(area: AuthArea, header: string | undefined): string | undefined {
  const name = `eyadex-${area}.two_factor`;
  for (const pair of (header ?? "").split(";")) {
    const at = pair.indexOf("=");
    if (at < 0) continue;
    const key = pair.slice(0, at).trim();
    if (key === name || key === `__Secure-${name}`) return pair.slice(at + 1).trim();
  }
  return undefined;
}

/**
 * العدّادات اللي بتتعدّ على الطلب ده قبل ما يوصل Better Auth (ADR-0005). مسار مش محدود → قايمة فاضية.
 *
 * @param ctx اللي الـ handler عارفه عن الطلب
 * @returns الأبعاد
 */
export function rateRulesFor(ctx: RateContext): RateRule[] {
  const route = routeOf(ctx.path);
  const rules: RateRule[] = [];
  if (ctx.path === "/sign-in/email") {
    rules.push({ route, dimension: "ip", value: ipOf(ctx.ip), limit: AUTH_LIMITS.signInPerIp });
    const email = emailOf(ctx.body);
    if (email !== undefined) {
      rules.push({ route, dimension: "email", value: email, limit: AUTH_LIMITS.signInPerEmail });
    }
  } else if (SECOND_FACTOR_PATHS.has(ctx.path)) {
    rules.push({
      route,
      dimension: "ip",
      value: ipOf(ctx.ip),
      limit: AUTH_LIMITS.secondFactorPerIp,
    });
    const subject =
      ctx.userId !== undefined
        ? `user:${ctx.userId}`
        : twoFactorCookie(ctx.area, ctx.cookieHeader) === undefined
          ? undefined
          : `pending:${twoFactorCookie(ctx.area, ctx.cookieHeader)}`;
    if (subject !== undefined) {
      rules.push({
        route,
        dimension: "subject",
        value: subject,
        limit: AUTH_LIMITS.secondFactorPerSubject,
      });
    }
  } else if (USER_PATHS.has(ctx.path) && ctx.userId !== undefined) {
    rules.push({
      route,
      dimension: "user",
      value: ctx.userId,
      limit: AUTH_LIMITS.sensitivePerUser,
    });
  }
  return rules;
}
