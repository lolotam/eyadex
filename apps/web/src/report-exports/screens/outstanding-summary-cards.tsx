import { useI18n } from "@/shared/i18n/i18n-provider";
import type { OutstandingPage } from "./use-outstanding-pages";
import { bucketTotals, bucketTotalsByBranch, type BucketTotal } from "./outstanding-summary";
import { useReportFormat } from "./use-report-format";

type Props = {
  summary: OutstandingPage["summary"];
  currency: string;
  exponent: number;
  /** Shown per branch only when no branch filter is chosen. */
  perBranch: boolean;
  branchName: (branchId: string) => string;
};

/** Whole-range owed amounts per age bucket (from the response summary), then per branch. */
export function OutstandingSummaryCards(props: Props) {
  const { t } = useI18n();
  const fmt = useReportFormat(props.currency, props.exponent);
  const grid = (totals: BucketTotal[], scope: string) => (
    <ul className="grid grid-cols-2 gap-2 md:grid-cols-4" data-scope={scope}>
      {totals.map((total) => (
        <li
          key={total.bucket}
          className="rounded-md border bg-card p-3"
          data-bucket-card={total.bucket}
        >
          <p className="text-xs text-muted-foreground">
            {t(`financeReports.outstanding.buckets.${total.bucket}`)}
          </p>
          <p className="mt-1 font-semibold tabular-nums" data-owed>
            {fmt.money(total.owedMinor)}
          </p>
          <p className="text-xs text-muted-foreground" data-count>
            {t("financeReports.outstanding.invoiceCount", {
              count: fmt.count(total.invoiceCount),
            })}
          </p>
        </li>
      ))}
    </ul>
  );
  return (
    <section
      className="flex flex-col gap-3"
      aria-label={t("financeReports.outstanding.summaryTitle")}
    >
      <div>
        <h2 className="text-sm font-semibold">{t("financeReports.outstanding.summaryTitle")}</h2>
        <p className="text-xs text-muted-foreground">
          {t("financeReports.outstanding.summaryNote")}
        </p>
      </div>
      {grid(bucketTotals(props.summary), "all")}
      {props.perBranch
        ? bucketTotalsByBranch(props.summary).map((branch) => (
            <div key={branch.branchId} className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold">{props.branchName(branch.branchId)}</h3>
              {grid(branch.buckets, "branch")}
            </div>
          ))
        : null}
    </section>
  );
}
