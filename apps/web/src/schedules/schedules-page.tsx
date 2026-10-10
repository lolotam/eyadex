import { RequirePermission } from "@/shared/permissions/require-permission";
import { ClinicSettingsShell } from "@/settings/clinic-settings-shell";
import { SchedulesContent } from "./schedules-content";

/** `/clinic/settings/schedules` (D-6, D-17). */
export function SchedulesPage() {
  return (
    <RequirePermission resource="schedules">
      <ClinicSettingsShell active="schedules">
        <SchedulesContent />
      </ClinicSettingsShell>
    </RequirePermission>
  );
}
