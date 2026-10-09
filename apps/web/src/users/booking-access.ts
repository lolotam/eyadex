import type { SessionContext } from "@eyadex/contracts/session";
import { can } from "@/shared/permissions/can";

/** Hiding the action is UX only: the API refuses without update:users:clinic or with the module off. */
export function mayEditBooking(session: Pick<SessionContext, "permissions" | "features">): boolean {
  return session.features.appointments && can(session.permissions, "update", "users");
}
