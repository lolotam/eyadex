import type { Payment } from "@eyadex/contracts/finance";
import type { Persona } from "@eyadex/contracts/session";
import { formatMinor } from "@eyadex/contracts/money";
import { z } from "zod";
import { writeClinicAudit } from "./mock-audit";
import { requirePayments } from "./mock-payment-access";
import { getPayment } from "./mock-payment-reads";
import { parse } from "./mock-medical-access";
import { demoPdf } from "./mock-pdf-document";
import { getState, persist } from "./mock-store";

/** Demo-only Latin receipt; the API owns the complete bilingual native document. */
export function renderReceiptPdf(payment: Payment): Blob {
  return demoPdf([
    `Receipt ${payment.receiptNumber}`,
    `Invoice ${payment.invoiceNumber}`,
    `Received ${payment.businessDate}`,
    `Amount ${formatMinor(payment.amountMinor, payment.currencyExponent)} ${payment.currency}`,
    `Method ${payment.method}`,
  ]);
}

/** Revalidate after generating the file, so a revoked caller gets neither bytes nor an audit row. */
export async function receiptPdf(
  persona: Persona,
  id: string,
  render: (payment: Payment) => Blob | Promise<Blob> = renderReceiptPdf,
): Promise<Blob> {
  const initial = requirePayments(getState(), persona, "view");
  // A role persona may resolve to a different account later; retain the original membership.
  const caller = { ...persona, memberId: initial.member.id };
  parse(z.string().uuid(), id);
  const payment = getPayment(getState(), caller, id);
  const file = await render(payment);
  const current = getState();
  getPayment(current, caller, id);
  const actor = requirePayments(current, caller, "view");
  writeClinicAudit(current, {
    clinicId: actor.clinic.id,
    actorName: actor.actorName,
    action: "payment.pdf_opened",
    entity: "payment",
    entityId: payment.id,
    before: null,
    after: null,
  });
  persist();
  return file;
}
