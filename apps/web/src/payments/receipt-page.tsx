import { RequirePermission } from "@/shared/permissions/require-permission";
import { ReceiptDetails } from "./receipt-details";

/** `/clinic/receipts/$paymentId`: any `view:payments` key; a receipt out of reach is not_found. */
export function ReceiptPage({ paymentId }: { paymentId: string }) {
  return (
    <RequirePermission resource="payments">
      <ReceiptDetails paymentId={paymentId} />
    </RequirePermission>
  );
}
