import { ClinicSettingsShell } from "@/settings/clinic-settings-shell";
import { RequirePermission } from "@/shared/permissions/require-permission";
import { MedicinesContent } from "./medicines-content";

/** `/clinic/settings/medicines` (P2-F2): `view:medicines:clinic` to read, `update` to change. */
export function MedicinesPage() {
  return (
    <RequirePermission resource="medicines">
      <ClinicSettingsShell active="medicines">
        <MedicinesContent />
      </ClinicSettingsShell>
    </RequirePermission>
  );
}
