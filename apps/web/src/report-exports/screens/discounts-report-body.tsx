import { can } from "@/shared/permissions/can";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useSession } from "@/shared/persona/persona-provider";
import { AdjustmentPagesFooter } from "./adjustment-pages-footer";
import { useDiscountsColumns } from "./discounts-columns";
import { sumMinor } from "./report-money";
import { ReportTable } from "./report-table";
import type { useDiscountsPages } from "./use-discounts-pages";
import { useReportFormat } from "./use-report-format";

type Props = { pages: ReturnType<typeof useDiscountsPages> };

/** The loaded discounts; a total only once every page is in (then it is the sum of the rows). */
export function DiscountsReportBody({ pages }: Props) {
  const { t } = useI18n();
  const { session } = useSession();
  const fmt = useReportFormat(pages.currency ?? "", pages.exponent);
  const columns = useDiscountsColumns(fmt, can(session?.permissions ?? [], "view", "invoices"));
  return (
    <div className="flex flex-col gap-4">
      <ReportTable
        caption={t("financeReports.names.discounts")}
        columns={columns}
        rows={pages.rows}
        rowKey={(_row, index) => `discount-${index}`}
        totals={
          pages.hasMore
            ? undefined
            : { discount: fmt.money(sumMinor(pages.rows.map((r) => r.discountMinor))) }
        }
      />
      <AdjustmentPagesFooter
        testId="discounts-showing"
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
