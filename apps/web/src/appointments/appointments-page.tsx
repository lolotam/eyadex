import { RequirePermission } from "@/shared/permissions/require-permission";
import { AppointmentsContent } from "./appointments-content";

/**
 * `/clinic/appointments`: the branch day (spec §5, slice A2). Any view key opens it; under `own` only the
 * reads answer with the caller's own column and appointments, and nothing can be booked (A3).
 */
export function AppointmentsPage() {
  return (
    <RequirePermission resource="appointments">
      <AppointmentsContent />
    </RequirePermission>
  );
}
