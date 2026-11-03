import { reportPatientCreditQuerySchema } from "@eyadex/contracts/finance-reports";
import { PatientCreditReportBody } from "./patient-credit-report-body";
import { ReportContent } from "./report-content";
import { ReportShell } from "./report-shell";
import { useReportFilters } from "./use-report-filters";
import { usePatientCreditPages, type PatientCreditQuery } from "./use-patient-credit-pages";

/** The dates only: the pager owns the cursor and page size, and R6 never sends a branch. */
const filtersOf = (query: PatientCreditQuery | null) =>
  query === null ? null : { from: query.from, to: query.to };

/** R6 «أرصدة المراجعين»: the current clinic-wide credit per المراجع, 50 per page. */
export function PatientCreditReportPage() {
  const f = useReportFilters<PatientCreditQuery>("patient_credit", reportPatientCreditQuerySchema);
  const pages = usePatientCreditPages(filtersOf(f.query));
  return (
    <ReportShell
      report="patient_credit"
      filters={f.filters}
      zone={f.zone}
      issues={f.issues}
      onChange={f.set}
    >
      {f.query === null && !f.waiting ? null : (
        <ReportContent
          loading={f.waiting || pages.isLoading}
          error={pages.error}
          empty={pages.currency !== null && pages.rows.length === 0}
          onRetry={pages.retry}
        >
          {pages.currency !== null ? <PatientCreditReportBody pages={pages} /> : null}
        </ReportContent>
      )}
    </ReportShell>
  );
}
