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
