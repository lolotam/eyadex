import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { PageHeader } from "@/shared/shell/page-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { useNewClinicSettings } from "./clinic-queries";
import { CreateClinicForm } from "./create-clinic-form";
import { newClinicFormValues } from "./new-clinic-form-values";

/** The form opens once the platform settings are read: they are its starting limits and modules. */
export function CreateClinicPage() {
  const { t } = useI18n();
  const settings = useNewClinicSettings();
  if (settings.data) return <CreateClinicForm initialValues={newClinicFormValues(settings.data)} />;
  return (
    <div className="max-w-3xl">
      <PageHeader title={t("clinics.createTitle")} subtitle={t("clinics.createSubtitle")} />
      {settings.isError ? (
        <StatusPanel icon={AlertTriangle} title={t("platformSettings.loadError")} body="" />
      ) : (
        <LoadingBlock />
      )}
    </div>
  );
}
