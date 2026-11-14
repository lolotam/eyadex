import { useI18n } from "@/shared/i18n/i18n-provider";

type PrintFilter = { label: string; value: string };

type Props = {
  title: string;
  filters: PrintFilter[];
};

/** A print-only heading and the filters that produced the currently visible receipts or refunds. */
export function PaymentPrintSummary({ title, filters }: Props) {
  const { t } = useI18n();
  return (
    <section className="mb-4 hidden print:block" aria-label={t("payments.print.summary")}>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("payments.print.visibleOnly")}</p>
      <h3 className="mt-3 text-sm font-semibold">{t("payments.print.filters")}</h3>
      {filters.length === 0 ? (
        <p className="mt-1 text-sm">{t("payments.print.noFilters")}</p>
      ) : (
        <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {filters.map((filter) => (
            <div key={filter.label} className="flex gap-1">
              <dt className="font-medium">{filter.label}:</dt>
              <dd dir="auto">{filter.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
