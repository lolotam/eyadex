import { RequirePermission } from "@/shared/permissions/require-permission";
import { ClinicSettingsContent } from "./clinic-settings-content";

export function ClinicSettingsPage() {
  return (
    <RequirePermission resource="clinic_settings">
      <ClinicSettingsContent />
    </RequirePermission>
  );
}
