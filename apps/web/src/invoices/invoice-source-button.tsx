import { Link } from "@tanstack/react-router";
import { ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useSourceInvoiceLink } from "./use-source-invoice-link";

/** The visit page's «فاتورة» / «عرض الفاتورة» button (F1 §3). */
export function InvoiceSourceButton({
  visitId,
  appointmentId,
  branchId,
}: {
  visitId: string;
  appointmentId: string | null;
  branchId: string;
}) {
  const { t } = useI18n();
  const link = useSourceInvoiceLink({ kind: "visit", id: visitId, appointmentId, branchId });
  if (!link) return null;
  return (
    <Button variant="outline" size="sm" asChild>
      {link.kind === "view" ? (
        <Link to="/clinic/invoices/$invoiceId" params={{ invoiceId: link.invoiceId }}>
          <ReceiptText className="size-4" />
          {t("finance.invoice.view")}
        </Link>
      ) : (
        <Link to="/clinic/invoices/new" search={{ source: link.source, id: link.id }}>
          <ReceiptText className="size-4" />
          {t("finance.invoice.create")}
        </Link>
      )}
    </Button>
  );
}
