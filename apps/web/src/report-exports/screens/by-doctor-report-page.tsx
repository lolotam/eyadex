import { reportByDoctorQuerySchema } from "@eyadex/contracts/finance-reports";
import type { z } from "zod";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { ReportContent } from "./report-content";
import { ReportShell } from "./report-shell";
import { RevenueReportBody } from "./revenue-report-body";
import { useReportFilters } from "./use-report-filters";
import { useReportQuery } from "./use-report-query";

type Query = z.output<typeof reportByDoctorQuerySchema>;

/** R4 «الإيراد حسب الدكتور»: a management view of who billed what, not a commission statement. */
export function ByDoctorReportPage() {
  const { t } = useI18n();
  const f = useReportFilters<Query>("by_doctor", reportByDoctorQuerySchema);
  const q = useReportQuery("by_doctor", f.query, (api, persona, query) =>
    api.reports.byDoctor(persona, query),
  );
  const data = q.data;
  return (
    <ReportShell
      report="by_doctor"
      filters={f.filters}
      zone={f.zone}
      issues={f.issues}
      onChange={f.set}
    >
      {f.query === null && !f.waiting ? null : (
        <ReportContent
          loading={f.waiting || q.isLoading}
          error={q.error}
          empty={!data || data.rows.length === 0}
          onRetry={q.retry}
        >
          {data ? (
            <RevenueReportBody
              data={data}
              caption={t("financeReports.names.by_doctor")}
              nameLabel={t("financeReports.columns.doctor")}
            />
          ) : null}
        </ReportContent>
      )}
    </ReportShell>
  );
}
