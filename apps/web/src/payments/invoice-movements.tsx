import type { InvoicePayments } from "@/shared/api/payments-client";
import { useI18n } from "@/shared/i18n/i18n-provider";

type Props = { data: InvoicePayments; format: (minor: string) => string };

/** The invoice's movements oldest first: receipts, credit applied, money released into credit. */
export function InvoiceMovements({ data, format }: Props) {
  const { t, formatDate } = useI18n();
  if (data.movements.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("payments.panel.noMovements")}</p>;
  }
  return (
    <ul className="divide-y rounded-md border text-sm">
      {data.movements.map((m) => {
        const key =
          m.kind === "payment"
            ? m.paymentId
            : m.kind === "credit_applied"
              ? m.allocationId
              : m.kind === "credit_released"
                ? m.creditId
                : m.refundId;
        const title =
          m.kind === "payment"
            ? t("payments.movement.payment", { number: m.receiptNumber })
            : m.kind === "credit_applied"
              ? t("payments.movement.credit_applied")
              : m.kind === "credit_released"
                ? t("payments.movement.credit_released", { cause: t(`payments.cause.${m.cause}`) })
                : t("payments.movement.refund", { number: m.refundNumber });
        const method = m.kind === "payment" || m.kind === "refund" ? m.method : null;
        return (
          <li key={key} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div className="min-w-0">
              <div className="font-medium" dir="auto">
                {title}
              </div>
              <div className="text-xs text-muted-foreground">
                {[formatDate(m.at), method ? t(`payments.method.${method}`) : null]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            <span className="tabular-nums">{format(m.amountMinor)}</span>
          </li>
        );
      })}
    </ul>
  );
}
