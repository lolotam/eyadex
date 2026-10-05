/** A Better Auth route the API exposes, relative to `/auth`. */
export interface AuthRoute {
  readonly method: "GET" | "POST";
  readonly path: string;
  /** Reachable on the platform host by a session that has not enrolled TOTP yet (PRD §4.10). */
  readonly beforeTwoFactor: boolean;
}

// ALLOWLIST: anything not listed here (sign-up, delete-user, update-user, list-sessions, …) answers 404.
const ROUTES: readonly AuthRoute[] = [
  // Sign-in needs no session; it is open so an unenrolled platform user can start the enrollment.
  { method: "POST", path: "/sign-in/email", beforeTwoFactor: true },
  { method: "POST", path: "/sign-out", beforeTwoFactor: true },
  { method: "GET", path: "/get-session", beforeTwoFactor: false },
  { method: "POST", path: "/change-password", beforeTwoFactor: false },
  { method: "POST", path: "/two-factor/enable", beforeTwoFactor: true },
  { method: "POST", path: "/two-factor/verify-totp", beforeTwoFactor: true },
  { method: "POST", path: "/two-factor/disable", beforeTwoFactor: false },
  { method: "POST", path: "/two-factor/generate-backup-codes", beforeTwoFactor: false },
  { method: "POST", path: "/two-factor/verify-backup-code", beforeTwoFactor: false },
];

export const ENABLE_TWO_FACTOR_PATH = "/two-factor/enable";

/**
 * بيدوّر على المسار في الـ allowlist بمطابقة حرفية (مفيش decode ولا trailing slash).
 *
 * @param method الـ HTTP method
 * @param path المسار بعد `/auth` ومن غير query
 * @returns الـ route أو `undefined` (يعني 404)
 */
export function findAuthRoute(method: string, path: string): AuthRoute | undefined {
  return ROUTES.find((route) => route.method === method && route.path === path);
}
