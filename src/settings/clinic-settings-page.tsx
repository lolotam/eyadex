import { RequirePermission } from "@/shared/permissions/require-permission";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { PageHeader } from "@/shared/shell/page-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { AlertTriangle } from "lucide-react";
import { ClinicSettingsForm } from "./clinic-settings-form";
import { useClinicSettings } from "./settings-queries";

function ClinicSettingsContent() {
  const { t } = useI18n();
  const query = useClinicSettings();
  return (
    <div>
      <PageHeader title={t("clinicSettings.title")} subtitle={t("clinicSettings.subtitle")} />
      {query.isLoading ? (
        <LoadingBlock />
      ) : query.data ? (
        <ClinicSettingsForm settings={query.data} />
      ) : (
        <StatusPanel icon={AlertTriangle} title={t("clinicSettings.loadError")} body="" />
      )}
    </div>
  );
}

export function ClinicSettingsPage() {
  return (
    <RequirePermission resource="clinic_settings">
      <ClinicSettingsContent />
    </RequirePermission>
  );
}
