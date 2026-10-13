import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { SectionHeader } from "@/shared/shell/section-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { ClinicSettingsGuard } from "./clinic-settings-guard";
import { NotificationSettingsForm } from "./notification-settings-form";
import { useNotificationSettings } from "./notification-queries";
import { useWhatsappChannel } from "./whatsapp-queries";

export function NotificationSettingsContent() {
  const { t } = useI18n();
  const query = useNotificationSettings();
  const channel = useWhatsappChannel();
  return (
    <div>
      <SectionHeader
        title={t("notificationSettings.title")}
        subtitle={t("notificationSettings.subtitle")}
      />
      {query.isLoading || channel.isLoading ? (
        <LoadingBlock />
      ) : query.data ? (
        <NotificationSettingsForm
          settings={query.data}
          whatsappConnected={channel.data?.status === "connected"}
        />
      ) : (
        <StatusPanel icon={AlertTriangle} title={t("clinicSettings.loadError")} body="" />
      )}
    </div>
  );
}

/** `/clinic/settings/notifications`. */
export function NotificationSettingsPage() {
  return (
    <ClinicSettingsGuard active="notifications">
      <NotificationSettingsContent />
    </ClinicSettingsGuard>
  );
}
