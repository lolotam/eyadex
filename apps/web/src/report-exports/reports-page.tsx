import { PowerOff } from "lucide-react";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona, useSession } from "@/shared/persona/persona-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { PageHeader } from "@/shared/shell/page-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { ExportHistory } from "./export-history";
import { ExportRequestForm } from "./export-request-form";

/**
 * `/clinic/reports`: the export form, then the requester's own history. Only the finance module
 * gates the page: listing one's own exports needs no report key, so the form alone refuses new
 * requests once report keys are gone (F3 design §4). The clinic shell handles blocked and disabled.
 */
export function ReportsPage() {
  const { t } = useI18n();
  const { persona, ready } = usePersona();
  const { session, isLoading, error } = useSession();
  const coherent =
    ready &&
    !isLoading &&
    !error &&
    !!session?.membershipId &&
    !!session.clinic &&
    session.clinic.id === persona.clinicId &&
    session.persona.kind === persona.kind &&
    session.persona.memberId === persona.memberId;
  if (!coherent || session.blocked !== null) return <LoadingBlock />;
  if (session.features.finance !== true) {
    return (
      <StatusPanel
        icon={PowerOff}
        title={t("routes.clinicReports.title")}
        body={t("errors.module_disabled")}
      />
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-8">
      <PageHeader
        title={t("routes.clinicReports.title")}
        subtitle={t("routes.clinicReports.description")}
      />
      <ExportRequestForm />
      <ExportHistory />
    </div>
  );
}
