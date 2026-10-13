import { ClinicSettingsGuard } from "./clinic-settings-guard";
import { WhatsappSettingsContent } from "./whatsapp-settings-content";

/** `/clinic/settings/whatsapp`. */
export function WhatsappSettingsPage() {
  return (
    <ClinicSettingsGuard active="whatsapp">
      <WhatsappSettingsContent />
    </ClinicSettingsGuard>
  );
}
