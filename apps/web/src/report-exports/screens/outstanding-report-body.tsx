import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { can } from "@/shared/permissions/can";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useSession } from "@/shared/persona/persona-provider";
import { useExportBranchOptions } from "../use-export-branch-options";
import { useOutstandingColumns } from "./outstanding-columns";
import { OutstandingSummaryCards } from "./outstanding-summary-cards";
import { sumMinor } from "./report-money";
import { ReportTable } from "./report-table";
import type { useOutstandingPages } from "./use-outstanding-pages";
import { useReportFormat } from "./use-report-format";

type Props = { pages: ReturnType<typeof useOutstandingPages>; perBranch: boolean };

/** Cards (whole range), then the loaded rows, «عرض X من Y» and «تحميل المزيد». */
export function OutstandingReportBody({ pages, perBranch }: Props) {
  const { t, tDynamic, pick } = useI18n();
  const { session } = useSession();
  const currency = pages.currency ?? "";
  const fmt = useReportFormat(currency, pages.exponent);
  const columns = useOutstandingColumns(fmt, can(session?.permissions ?? [], "view", "invoices"));
  const branches = useExportBranchOptions("outstanding");
  const branchName = (id: string) => {
    const option = branches.items.find((b) => b.id === id);
    if (option) return pick(option.nameAr, option.nameEn);
    return (
      pages.rows.find((r) => r.branchId === id)?.branchName ??
      t("financeReports.outstanding.unknownBranch")
    );
  };
  const shown = fmt.count(pages.rows.length);
  const total = fmt.count(pages.total);
  const moreKnown = pages.moreError ? tDynamic(`errors.${pages.moreError}`) : "";
  return (
    <div className="flex flex-col gap-4">
      <OutstandingSummaryCards
        summary={pages.summary}
        currency={currency}
        exponent={pages.exponent}
        perBranch={perBranch}
        branchName={branchName}
      />
      <ReportTable
        caption={t("financeReports.names.outstanding")}
        columns={columns}
        rows={pages.rows}
        rowKey={(r) => r.invoiceId}
        totals={{
          total: fmt.money(sumMinor(pages.rows.map((r) => r.totalMinor))),
          paid: fmt.money(sumMinor(pages.rows.map((r) => r.paidMinor))),
          owed: fmt.money(sumMinor(pages.rows.map((r) => r.owedMinor))),
        }}
      />
      <p className="text-xs text-muted-foreground" data-testid="outstanding-showing">
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
