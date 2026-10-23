import { readMinor } from "@eyadex/contracts/money";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InvoicePayments } from "@/shared/api/payments-client";
import { useI18n } from "@/shared/i18n/i18n-provider";

type PaymentMovement = Extract<InvoicePayments["movements"][number], { kind: "payment" }>;
type Props = {
  data: InvoicePayments;
  format: (minor: string) => string;
  /** Given only to a caller who may refund at the invoice's branch. */
  onRefund?: (movement: PaymentMovement) => void;
};

/**
 * The invoice's movements oldest first: receipts, credit applied, money released, refunds. A wrong receipt
 * is corrected by a refund and a new payment (F2-Q12), so a receipt has no delete or cancel action.
 */
export function InvoiceMovements({ data, format, onRefund }: Props) {
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
              {m.kind === "refund" && (
                <div className="mt-0.5 break-words text-xs text-muted-foreground" dir="auto">
                  {m.reason}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="tabular-nums" dir="ltr">
                {m.kind === "refund" ? "−" : ""}
                {format(m.amountMinor)}
              </span>
              {onRefund && m.kind === "payment" && (readMinor(m.refundableMinor) ?? 0n) > 0n && (
                <Button size="sm" variant="ghost" onClick={() => onRefund(m)}>
                  <Undo2 className="size-4" />
                  {t("payments.refund.action")}
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
