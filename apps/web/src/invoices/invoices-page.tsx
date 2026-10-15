import { RequirePermission } from "@/shared/permissions/require-permission";
import { InvoicesContent } from "./invoices-content";

/** `/clinic/invoices`: any `view:invoices` key; the API narrows the rows to its scope. */
export function InvoicesPage() {
  return (
    <RequirePermission resource="invoices">
      <InvoicesContent />
    </RequirePermission>
  );
}
