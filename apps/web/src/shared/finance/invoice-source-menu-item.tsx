import { useNavigate } from "@tanstack/react-router";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useSourceInvoiceLink } from "./use-source-invoice-link";

/**
 * The appointment menu's «فاتورة» entry (F1 §3). It mounts only while the menu is open, so the
 * calendar asks for one appointment's invoice at a time, never for every block.
 */
export function InvoiceSourceMenuItem({ appointmentId }: { appointmentId: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const link = useSourceInvoiceLink("appointment", appointmentId);
  if (!link) return null;
  return (
    <DropdownMenuItem
      onSelect={() =>
        void (link.kind === "view"
          ? navigate({ to: "/clinic/invoices/$invoiceId", params: { invoiceId: link.invoiceId } })
          : navigate({ to: "/clinic/invoices/new", search: { source: link.source, id: link.id } }))
      }
    >
      {t(link.kind === "view" ? "finance.invoice.view" : "finance.invoice.create")}
    </DropdownMenuItem>
  );
}
