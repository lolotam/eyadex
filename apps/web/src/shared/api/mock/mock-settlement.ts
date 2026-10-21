import type { InvoiceSettlement } from "@eyadex/contracts/finance";
import { SettlementError, invoiceSettlement } from "@eyadex/contracts/settlement";
import { ApiError, financeError } from "../api-error";
import type { StoredInvoice } from "./mock-finance-state";
import { moneyOf } from "./mock-payment-state";
import type { MockState } from "./mock-store";

/** The invoice as the shared settlement functions read it. */
export const settlementInvoice = (invoice: StoredInvoice) => ({
  id: invoice.id,
  status: invoice.status,
  totalMinor: BigInt(invoice.totalMinor),
});

/** The settlement every invoice answer carries (spec §4.3): null on a void invoice. */
export function settlementOf(db: MockState, invoice: StoredInvoice): InvoiceSettlement | null {
  const s = invoiceSettlement(
    moneyOf(db, invoice.clinicId, invoice.patientId),
    settlementInvoice(invoice),
  );
  return s && { state: s.state, paidMinor: String(s.paidMinor), owedMinor: String(s.owedMinor) };
}

/** Runs a settlement plan and answers its refusal with the API's code for it. */
export function settle<T>(plan: () => T): T {
  try {
    return plan();
  } catch (error) {
    if (!(error instanceof SettlementError)) throw error;
    if (error.code === "invalid_amount") throw new ApiError("validation");
    if (error.code === "invoice_void") throw new ApiError("invoice_void");
    throw financeError(error.code);
  }
}
