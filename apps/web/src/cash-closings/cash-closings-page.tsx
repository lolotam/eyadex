import { RequirePermission } from "@/shared/permissions/require-permission";
import { ClosingsContent } from "./closings-content";

/** `/clinic/cash-closings`: any `view:cash_closings` key; the API narrows the rows to its reach. */
export function CashClosingsPage() {
  return (
    <RequirePermission resource="cash_closings">
      <ClosingsContent />
    </RequirePermission>
  );
}
