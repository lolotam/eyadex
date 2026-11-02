import { useParams } from "@tanstack/react-router";
import { FileQuestion, PowerOff } from "lucide-react";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona, useSession } from "@/shared/persona/persona-provider";
import { ForbiddenPage } from "@/shared/shell/forbidden-page";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { StatusPanel } from "@/shared/shell/status-panel";
import { canOpenReport, isReportId, isScreenReport } from "./report-catalogue";
import { DailyTakingsPage } from "./daily-takings-page";
import { PeriodSummaryPage } from "./period-summary-page";
import { CashClosingsReportPage } from "./cash-closings-report-page";
import { ByServiceReportPage } from "./by-service-report-page";
import { ByDoctorReportPage } from "./by-doctor-report-page";

/**
 * `/clinic/reports/<reportId>`: an unknown or not-yet-built report is "not found"; a report the
 * caller's permissions do not open is the standard forbidden page. The API refuses on its own too.
 */
export function ReportScreenPage() {
  const { reportId } = useParams({ from: "/clinic/reports/$reportId" });
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
  if (session.features.finance !== true)
    return (
      <StatusPanel
        icon={PowerOff}
        title={t("routes.clinicReports.title")}
        body={t("errors.module_disabled")}
      />
    );
  if (!isReportId(reportId) || !isScreenReport(reportId))
    return (
      <StatusPanel
        icon={FileQuestion}
        title={t("routes.clinicReport.title")}
        body={t("errors.not_found")}
      />
    );
  if (!canOpenReport(session.permissions, reportId)) return <ForbiddenPage />;
  if (reportId === "by_service") return <ByServiceReportPage key={persona.memberId} />;
  if (reportId === "by_doctor") return <ByDoctorReportPage key={persona.memberId} />;
  if (reportId === "cash_closings") return <CashClosingsReportPage key={persona.memberId} />;
  return reportId === "daily_takings" ? (
    <DailyTakingsPage key={persona.memberId} />
  ) : (
    <PeriodSummaryPage key={persona.memberId} />
  );
}
