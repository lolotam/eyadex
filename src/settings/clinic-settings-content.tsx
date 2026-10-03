import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { PageHeader } from "@/shared/shell/page-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { ClinicSettingsForm } from "./clinic-settings-form";
import { useClinicSettings } from "./settings-queries";

export function ClinicSettingsContent() {
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
