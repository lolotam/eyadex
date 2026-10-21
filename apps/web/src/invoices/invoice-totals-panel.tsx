import type { InvoiceSettlement } from "@eyadex/contracts/finance";
import type { Totals } from "@eyadex/contracts/invoice-totals";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { formatBp } from "@/shared/money/use-clinic-money";
import { InvoiceSettlementChip } from "./invoice-settlement-chip";

type Props = {
  totals:
    | Pick<Totals, "subtotalMinor" | "discountMinor" | "taxMinor" | "totalMinor">
    | {
        subtotalMinor: string;
        discountMinor: string;
        taxMinor: string;
        totalMinor: string;
        /** An issued invoice's settlement (F2): paid and balance due under the total. */
        settlement?: InvoiceSettlement | null | undefined;
      };
  taxRateBp: number;
  format: (minor: string) => string;
};

/** Subtotal, discounts, the tax line (only when the rate is above 0), the total and, once issued, paid and due. */
export function InvoiceTotalsPanel({ totals, taxRateBp, format }: Props) {
  const { t } = useI18n();
  const row = (label: string, minor: bigint | string, strong = false) => (
    <div className={`flex justify-between gap-4 ${strong ? "border-t pt-2 font-semibold" : ""}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{format(minor.toString())}</dd>
    </div>
  );
  return (
    <dl className="ms-auto flex w-full max-w-xs flex-col gap-1 text-sm">
      {row(t("finance.invoice.subtotal"), totals.subtotalMinor)}
      {totals.discountMinor.toString() !== "0" &&
        row(t("finance.invoice.discounts"), totals.discountMinor)}
      {taxRateBp > 0 &&
        row(t("finance.invoice.tax", { rate: formatBp(taxRateBp) }), totals.taxMinor)}
      {row(t("finance.invoice.total"), totals.totalMinor, true)}
      {"settlement" in totals && totals.settlement && (
        <>
          {row(t("payments.panel.paid"), totals.settlement.paidMinor)}
          {row(t("payments.panel.owed"), totals.settlement.owedMinor, true)}
          <div className="flex justify-end">
            <InvoiceSettlementChip settlement={totals.settlement} />
          </div>
        </>
      )}
    </dl>
  );
}
