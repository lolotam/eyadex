import { can } from "@/shared/permissions/can";
import { useSession } from "@/shared/persona/persona-provider";
import { useSourceInvoice } from "./invoice-queries";

export type SourceInvoiceLink =
  | { kind: "view"; invoiceId: string }
  | { kind: "create"; source: "appointment" | "visit"; id: string }
  | null;

/**
 * F1 §3: what the «فاتورة» control of an appointment or visit offers — the live invoice when one
 * exists, else a new one (needs `create:invoices:*`), else nothing. Hidden while finance is off.
 */
export function useSourceInvoiceLink(
  source: "appointment" | "visit",
  id: string,
  active = true,
): SourceInvoiceLink {
  const { session } = useSession();
  const keys = session?.permissions ?? [];
  const on = active && session?.features.finance === true && can(keys, "view", "invoices");
  const existing = useSourceInvoice(source, id, on);
  if (!on || existing.isLoading || existing.isError) return null;
  if (existing.data) return { kind: "view", invoiceId: existing.data.id };
  return can(keys, "create", "invoices") ? { kind: "create", source, id } : null;
}
