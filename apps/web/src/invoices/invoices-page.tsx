import { Navigate } from "@tanstack/react-router";
import { can } from "@/shared/permissions/can";
import { RequirePermission } from "@/shared/permissions/require-permission";
import { useSession } from "@/shared/persona/persona-provider";
import { InvoicesContent } from "./invoices-content";

/**
 * `/clinic/invoices`: any `view:invoices` key; the API narrows the rows to its scope. A payments-only
 * role reaches the menu entry too and lands on the first tab it can see, the receipts.
 */
export function InvoicesPage() {
  const { session } = useSession();
  const perms = session?.permissions ?? [];
  if (session && !can(perms, "view", "invoices") && can(perms, "view", "payments"))
    return <Navigate to="/clinic/payments" replace />;
  return (
    <RequirePermission resource="invoices">
      <InvoicesContent />
    </RequirePermission>
  );
}
