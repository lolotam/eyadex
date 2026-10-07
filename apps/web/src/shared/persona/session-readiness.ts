import { errorCodeOf } from "@/shared/api/api-error";
import type { Area } from "@/shared/api/area-host";

/**
 * HTTP mode: screens may query once the area is known and, inside an area, a session is held. A
 * failed background refresh keeps the last session, so it must not flip the screens back to loading;
 * a 401 removes the session itself (`useHttpSessionGuard`).
 */
export function isSessionReady(area: Area | null | undefined, hasSession: boolean): boolean {
  if (area === undefined) return false;
  return area === null || hasSession;
}

/** Answers the area layouts handle themselves: sign-in, enrolment, a blocked subscription. */
const HANDLED = new Set(["unauthorized", "two_factor_required", "subscription_blocked"]);

/**
 * HTTP mode: the first session read failed for another reason (network, 5xx), so there is nothing
 * to show; the layout offers a retry instead of loading forever. A failed refresh keeps the session.
 */
export function isSessionLoadFailure(error: unknown, hasSession: boolean): boolean {
  return error != null && !hasSession && !HANDLED.has(errorCodeOf(error));
}
