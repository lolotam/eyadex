import { RequirePermission } from "@/shared/permissions/require-permission";
import { AppointmentsContent } from "./appointments-content";

/** `/clinic/appointments`: the branch day (spec §5, slice A2). */
export function AppointmentsPage() {
  return (
    <RequirePermission resource="appointments">
      <AppointmentsContent />
    </RequirePermission>
  );
}
