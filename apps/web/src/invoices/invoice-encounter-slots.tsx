import type { EncounterSlots } from "@/shared/shell/encounter-slots";
import { InvoiceSourceButton } from "./invoice-source-button";
import { InvoiceSourceMenuItem } from "./invoice-source-menu-item";

/** F1 §3: the «فاتورة» controls the appointments and visit routes put in their pages. */
export const INVOICE_ENCOUNTER_SLOTS: EncounterSlots = {
  appointmentMenu: (a) => <InvoiceSourceMenuItem appointmentId={a.id} branchId={a.branchId} />,
  visitActions: (v) => (
    <InvoiceSourceButton visitId={v.id} appointmentId={v.appointmentId} branchId={v.branchId} />
  ),
};
