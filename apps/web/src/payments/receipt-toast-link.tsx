import { Link } from "@tanstack/react-router";
import type { Payment } from "@eyadex/contracts/finance";
import { useI18n } from "@/shared/i18n/i18n-provider";

/** The success toast's receipt number, opening the receipt page (card 1b). */
export function ReceiptToastLink({ payment }: { payment: Pick<Payment, "id" | "receiptNumber"> }) {
  const { t } = useI18n();
  return (
    <Link
      to="/clinic/receipts/$paymentId"
      params={{ paymentId: payment.id }}
      className="font-medium text-primary underline underline-offset-4"
    >
      {t("payments.dialog.receiptLink", { number: payment.receiptNumber })}
    </Link>
  );
}
