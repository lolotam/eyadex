import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TranslationKey } from "@/shared/i18n/dictionary";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { PageHeader } from "@/shared/shell/page-header";
import { SCREEN_CLINIC_WIDE_NOTICE, type ScreenReportId } from "./report-catalogue";
import { ClinicWideNotice } from "./clinic-wide-notice";
import { ReportExportDialog } from "./report-export-dialog";
import { ReportFiltersBar } from "./report-filters-bar";
import type { ReportFilterIssue, ReportFilters } from "./use-report-filters";
import "./report-print.css";

/** Each screen's own header note; R1 and R2 share the takings note. */
const SUBTITLE_KEY = {
  daily_takings: "financeReports.note",
  period_summary: "financeReports.note",
  cash_closings: "financeReports.cashClosingsNote",
  by_service: "financeReports.byServiceNote",
  by_doctor: "financeReports.byDoctorNote",
  outstanding: "financeReports.outstanding.note",
  patient_credit: "financeReports.patientCredit.note",
  refunds: "financeReports.adjustments.refundsNote",
  discounts: "financeReports.adjustments.discountsNote",
  own_summary: "financeReports.ownSummary.note",
} as const satisfies Record<ScreenReportId, TranslationKey>;

type Props = {
  report: ScreenReportId;
  filters: ReportFilters;
  zone: string;
  issues: Partial<Record<"from" | "to", ReportFilterIssue>>;
  onChange: (change: Partial<ReportFilters>) => void;
  children: ReactNode;
};

/** The frame every report screen shares: title, note, filters, export, print, then the body. */
export function ReportShell({ report, filters, zone, issues, onChange, children }: Props) {
  const { t } = useI18n();
  const notice = SCREEN_CLINIC_WIDE_NOTICE.has(report);
  return (
    <div data-report-print className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-4">
      <Link
        to="/clinic/reports"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden"
      >
        <ArrowRight className="size-4 ltr:rotate-180" aria-hidden />
        {t("financeReports.actions.back")}
      </Link>
      <PageHeader
        title={t(`financeReports.names.${report}`)}
        subtitle={t(SUBTITLE_KEY[report])}
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            {notice ? <ClinicWideNotice variant="inline" /> : null}
            <ReportExportDialog
              initial={{
                report,
                from: filters.from,
                to: filters.to,
                branchId: filters.branchId,
                groupBy: filters.groupBy,
              }}
            />
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="size-4" aria-hidden />
              {t("financeReports.actions.print")}
            </Button>
          </div>
        }
      />
      <ReportFiltersBar
        report={report}
        filters={filters}
        zone={zone}
        issues={issues}
        onChange={onChange}
      />
      {notice ? <ClinicWideNotice variant="banner" /> : null}
      {children}
    </div>
  );
}
