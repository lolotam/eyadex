import { RequirePermission } from "@/shared/permissions/require-permission";
import { AppointmentsContent } from "./appointments-content";

/**
 * `/clinic/appointments`: the branch day (spec §5, slice A2). Its reads need a branch or clinic key; an
 * `own` key alone gets the Forbidden page, never a page whose every read is refused (Codex PR #64).
 */
export function AppointmentsPage() {
  return (
    <RequirePermission resource="appointments" scopes={["clinic", "branch"]}>
      <AppointmentsContent />
    </RequirePermission>
  );
}
