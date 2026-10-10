import { RequirePermission } from "@/shared/permissions/require-permission";
import { ClinicSettingsShell } from "@/settings/clinic-settings-shell";
import { ServicesContent } from "./services-content";

/** `/clinic/settings/services` (D-12, D-17). */
export function ServicesPage() {
  return (
    <RequirePermission resource="services">
      <ClinicSettingsShell active="services">
        <ServicesContent />
      </ClinicSettingsShell>
    </RequirePermission>
  );
}
