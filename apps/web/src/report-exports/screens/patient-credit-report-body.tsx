import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePatientCreditColumns } from "./patient-credit-columns";
import { sumMinor } from "./report-money";
import { ReportTable } from "./report-table";
import type { usePatientCreditPages } from "./use-patient-credit-pages";
import { useReportFormat } from "./use-report-format";

type Props = { pages: ReturnType<typeof usePatientCreditPages> };

/** The loaded credit rows, «عرض X من Y» and «تحميل المزيد»; a total only once every page is in. */
export function PatientCreditReportBody({ pages }: Props) {
  const { t, tDynamic } = useI18n();
  const fmt = useReportFormat(pages.currency ?? "", pages.exponent);
  const columns = usePatientCreditColumns(fmt);
  const shown = fmt.count(pages.rows.length);
  const total = fmt.count(pages.total);
  const moreKnown = pages.moreError ? tDynamic(`errors.${pages.moreError}`) : "";
  return (
    <div className="flex flex-col gap-4">
      <ReportTable
        caption={t("financeReports.names.patient_credit")}
        columns={columns}
        rows={pages.rows}
        // Row positions, never the patient id: no patient identifier reaches the page.
        rowKey={(_row, index) => `credit-${index}`}
        // A total under a partial list would not be the clinic's total, so it appears only once
        // every page is loaded (then it is exactly the sum of the rows shown).
        totals={
          pages.hasMore
            ? undefined
            : { balance: fmt.money(sumMinor(pages.rows.map((r) => r.balanceMinor))) }
        }
      />
      <p className="text-xs text-muted-foreground" data-testid="patient-credit-showing">
        {t("financeReports.outstanding.showing", { shown, total })}
      </p>
      <p className="hidden text-xs print:block">
        {t("financeReports.outstanding.printNote", { shown, total })}
      </p>
      {pages.moreError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm print:hidden">
          <AlertCircle className="size-4 shrink-0 text-destructive" aria-hidden />
          {moreKnown.startsWith("errors.") ? t("financeReports.outstanding.moreError") : moreKnown}
          <Button variant="outline" size="sm" onClick={pages.retryMore}>
            {t("financeReports.outstanding.retryMore")}
          </Button>
        </div>
      ) : pages.hasMore ? (
        <Button
          variant="outline"
          className="w-fit print:hidden"
          disabled={pages.loadingMore}
          onClick={pages.loadMore}
        >
          {pages.loadingMore
            ? t("financeReports.outstanding.loadingMore")
            : t("financeReports.outstanding.loadMore")}
        </Button>
      ) : null}
    </div>
  );
}
