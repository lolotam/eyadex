import { RequirePermission } from "@/shared/permissions/require-permission";
import { ClosingDetails } from "./closing-details";

/** `/clinic/cash-closings/$closingId`: any `view:cash_closings` key; out of reach is not_found. */
export function CashClosingPage({ closingId }: { closingId: string }) {
  return (
    <RequirePermission resource="cash_closings">
      <ClosingDetails closingId={closingId} />
    </RequirePermission>
  );
}
