import { useI18n } from "@/shared/i18n/i18n-provider";
import { ReportTable } from "./report-table";
import { useRevenueColumns } from "./revenue-columns";
import { taxLast, type RevenueResponse } from "./revenue-rows";
import { useReportFormat } from "./use-report-format";

type Props = { data: RevenueResponse; caption: string; nameLabel: string };

/**
 * The R3 / R4 body: billed rows, then the tax row under its own heading, then the response's own
 * totals (billed, tax, total). Totals are never recomputed on screen.
 */
export function RevenueReportBody({ data, caption, nameLabel }: Props) {
  const { t } = useI18n();
  const fmt = useReportFormat(data.currency, data.currencyExponent);
  const columns = useRevenueColumns(fmt, nameLabel);
  const rows = taxLast<RevenueResponse["rows"][number]>(data.rows);
  const totals = data.totals;
  const summary = [
    ["billed", t("financeReports.revenue.billed"), totals.billedMinor],
    ["tax", t("financeReports.revenue.tax"), totals.taxMinor],
    ["total", t("financeReports.revenue.total"), totals.totalMinor],
  ] as const;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ReportTable
        caption={caption}
        columns={columns}
        rows={rows}
        rowKey={(r, i) => `${r.kind}-${i}`}
        groupOf={(r) =>
          r.kind === "tax"
            ? t("financeReports.revenue.taxGroup")
            : t("financeReports.revenue.linesGroup")
        }
        totals={{
          lineCount: fmt.count(totals.lineCount),
          quantity: fmt.count(totals.quantity),
          amount: fmt.money(totals.totalMinor),
        }}
      />
      <dl
        className="grid gap-1 rounded-md border bg-card p-3 text-sm sm:max-w-sm sm:ms-auto"
        data-testid="revenue-summary"
      >
        {summary.map(([key, label, minor]) => (
          <div
            key={key}
            data-total={key}
            className={`flex justify-between gap-3 ${key === "total" ? "border-t pt-1 font-semibold" : ""}`}
          >
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-end tabular-nums">{fmt.money(minor)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
