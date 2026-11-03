import { Fragment, type ReactNode } from "react";
import { useI18n } from "@/shared/i18n/i18n-provider";

export type ReportColumn<T> = {
  key: string;
  label: string;
  numeric?: boolean;
  cell: (row: T) => ReactNode;
};

type Props<T> = {
  caption: string;
  columns: ReportColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  /** The totals row: one node per numeric column key. Omitted when the rows shown are not the whole set. */
  totals?: Record<string, ReactNode> | undefined;
  /** Rows of one group are shown under a heading with this label. */
  groupOf?: (row: T) => string;
};

/**
 * A report's aggregate table: visible headers and a totals row at 1440px, one labelled card per
 * row at 390px (the export history pattern). Logical alignment only.
 */
export function ReportTable<T>({ caption, columns, rows, rowKey, totals, groupOf }: Props<T>) {
  const { t } = useI18n();
  const align = (numeric?: boolean) => (numeric ? "text-end tabular-nums" : "text-start");
  const groupStarts = (index: number) =>
    groupOf !== undefined &&
    (index === 0 || groupOf(rows[index - 1] as T) !== groupOf(rows[index] as T));
  return (
    <div className="min-w-0" data-testid="report-table">
      <table className="hidden w-full border-collapse rounded-md border bg-card text-sm md:table print:table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b bg-muted/40">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`px-3 py-2 text-xs font-medium text-muted-foreground ${align(c.numeric)}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <Fragment key={rowKey(row, index)}>
              {groupStarts(index) ? (
                <tr className="border-b bg-muted/20">
                  <th
                    scope="rowgroup"
                    colSpan={columns.length}
                    className="px-3 py-1.5 text-start text-xs font-semibold"
                  >
                    {groupOf?.(row)}
                  </th>
                </tr>
              ) : null}
              <tr className="border-b last:border-b-0" data-testid="report-row">
                {columns.map((c) => (
                  <td key={c.key} className={`px-3 py-2 ${align(c.numeric)}`}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            </Fragment>
          ))}
        </tbody>
        {totals ? (
          <tfoot>
            <tr className="border-t-2 font-semibold" data-testid="report-totals">
              {columns.map((c, index) => (
                <td key={c.key} className={`px-3 py-2 ${align(c.numeric)}`} data-column={c.key}>
                  {index === 0 ? t("financeReports.total") : (totals[c.key] ?? null)}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
      <ul className="flex flex-col gap-2 md:hidden print:hidden" aria-label={caption}>
        {rows.map((row, index) => (
          <li key={rowKey(row, index)} className="rounded-md border bg-card p-3">
            {groupStarts(index) ? (
              <p className="mb-2 text-xs font-semibold">{groupOf?.(row)}</p>
            ) : null}
            <dl className="grid gap-1">
              {columns.map((c) => (
                <div key={c.key} className="flex justify-between gap-3 text-sm">
                  <dt className="text-xs text-muted-foreground">{c.label}</dt>
                  <dd className={align(c.numeric)}>{c.cell(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
        {totals ? (
          <li className="rounded-md border-2 bg-card p-3 font-semibold">
            <p className="mb-2 text-xs">{t("financeReports.total")}</p>
            <dl className="grid gap-1">
              {columns
                .filter((c) => totals[c.key] !== undefined)
                .map((c) => (
                  <div key={c.key} className="flex justify-between gap-3 text-sm">
                    <dt className="text-xs text-muted-foreground">{c.label}</dt>
                    <dd className="text-end tabular-nums">{totals[c.key]}</dd>
                  </div>
                ))}
            </dl>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
