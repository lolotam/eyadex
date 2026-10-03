import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { PageHeader } from "@/shared/shell/page-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { PlatformSettingsForm } from "./platform-settings-form";
import { usePlatformSettings } from "./settings-queries";

export function PlatformSettingsPage() {
  const { t } = useI18n();
  const query = usePlatformSettings();
  return (
    <div>
      <PageHeader title={t("platformSettings.title")} subtitle={t("platformSettings.subtitle")} />
      {query.isLoading ? (
        <LoadingBlock />
      ) : query.data ? (
        <PlatformSettingsForm settings={query.data} />
      ) : (
        <StatusPanel icon={AlertTriangle} title={t("platformSettings.loadError")} body="" />
      )}
    </div>
  );
}
