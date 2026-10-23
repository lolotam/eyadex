import { RequirePermission } from "@/shared/permissions/require-permission";
import { PaymentsContent } from "./payments-content";

/** `/clinic/payments`: any `view:payments` key; the API narrows the rows to its reach. */
export function ReceiptsPage() {
  return (
    <RequirePermission resource="payments">
      <PaymentsContent />
    </RequirePermission>
  );
}
