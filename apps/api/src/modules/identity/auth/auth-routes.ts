import type { AuthArea } from "@eyadex/auth";

/** A Better Auth route the API exposes, relative to `/auth`. */
export interface AuthRoute {
  readonly method: "GET" | "POST";
  readonly path: string;
  /** Reachable on the platform host by a session that has not enrolled TOTP yet (PRD §4.10). */
  readonly beforeTwoFactor: boolean;
  /** Reachable on this area's host only; elsewhere it answers 404. */
  readonly onlyArea?: AuthArea;
}

// ALLOWLIST: anything not listed here (sign-up, delete-user, update-user, list-sessions, …) answers 404.
export const AUTH_ROUTES: readonly AuthRoute[] = [
  // Sign-in needs no session; it is open so an unenrolled platform user can start the enrollment.
  { method: "POST", path: "/sign-in/email", beforeTwoFactor: true },
  { method: "POST", path: "/sign-out", beforeTwoFactor: true },
  { method: "GET", path: "/get-session", beforeTwoFactor: false },
  { method: "POST", path: "/change-password", beforeTwoFactor: false },
  { method: "POST", path: "/two-factor/enable", beforeTwoFactor: true },
  { method: "POST", path: "/two-factor/verify-totp", beforeTwoFactor: true },
  // TOTP is mandatory on the platform (PRD §4.10): turning it off there is not an option, and a stolen
  // session + password must not be able to swap the second factor for the attacker's.
  { method: "POST", path: "/two-factor/disable", beforeTwoFactor: false, onlyArea: "clinic" },
  { method: "POST", path: "/two-factor/generate-backup-codes", beforeTwoFactor: false },
  { method: "POST", path: "/two-factor/verify-backup-code", beforeTwoFactor: false },
];

export const ENABLE_TWO_FACTOR_PATH = "/two-factor/enable";
export const VERIFY_TOTP_PATH = "/two-factor/verify-totp";
/** Routes whose body may carry `trustDevice` (Better Auth's 30-day "skip TOTP on this browser"). */
export const TRUST_DEVICE_PATHS: ReadonlySet<string> = new Set([
  VERIFY_TOTP_PATH,
  "/two-factor/verify-backup-code",
]);

/**
 * بيدوّر على المسار في الـ allowlist بمطابقة حرفية (مفيش decode ولا trailing slash).
 *
 * @param method الـ HTTP method
 * @param path المسار بعد `/auth` ومن غير query
 * @returns الـ route أو `undefined` (يعني 404)
 */
export function findAuthRoute(method: string, path: string): AuthRoute | undefined {
  return AUTH_ROUTES.find((route) => route.method === method && route.path === path);
}
