import { useI18n } from "@/shared/i18n/i18n-provider";
import { AdjustmentPagesFooter } from "./adjustment-pages-footer";
import { useRefundsColumns } from "./refunds-columns";
import { sumMinor } from "./report-money";
import { ReportTable } from "./report-table";
import type { useRefundsPages } from "./use-refunds-pages";
import { useReportFormat } from "./use-report-format";

type Props = { pages: ReturnType<typeof useRefundsPages> };

/** The loaded refunds; a total only once every page is in (then it is the sum of the rows). */
export function RefundsReportBody({ pages }: Props) {
  const { t } = useI18n();
  const fmt = useReportFormat(pages.currency ?? "", pages.exponent);
  const columns = useRefundsColumns(fmt);
  return (
    <div className="flex flex-col gap-4">
      <ReportTable
        caption={t("financeReports.names.refunds")}
        columns={columns}
        rows={pages.rows}
        // Row positions, never an id: no refund or patient identifier reaches the page.
        rowKey={(_row, index) => `refund-${index}`}
        totals={
          pages.hasMore
            ? undefined
            : { amount: fmt.money(sumMinor(pages.rows.map((r) => r.amountMinor))) }
        }
      />
      <AdjustmentPagesFooter
        testId="refunds-showing"
        shown={fmt.count(pages.rows.length)}
        total={fmt.count(pages.total)}
        hasMore={pages.hasMore}
        loadingMore={pages.loadingMore}
        moreError={pages.moreError}
        loadMore={pages.loadMore}
        retryMore={pages.retryMore}
      />
    </div>
  );
}
