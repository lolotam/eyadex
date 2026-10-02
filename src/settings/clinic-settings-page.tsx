import { RequirePermission } from "@/shared/permissions/require-permission";
import { ComingNextPage } from "@/shared/shell/coming-next-page";

export function ClinicSettingsPage() {
  return (
    <RequirePermission resource="clinic_settings">
      <ComingNextPage title="nav.settings" />
    </RequirePermission>
  );
}
