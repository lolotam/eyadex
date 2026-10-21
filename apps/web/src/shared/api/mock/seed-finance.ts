import { NO_FEATURES } from "@eyadex/contracts/clinics";
import type { CreateInvoiceRequest } from "@eyadex/contracts/finance";
import type { Persona } from "@eyadex/contracts/session";
import { guardFinance } from "./mock-finance-access";
import { issueInvoice, voidInvoice } from "./mock-invoice-writes";
import { recordPayment } from "./mock-payment-writes";
import type { MockState } from "./mock-store";

const line = (amount: string): CreateInvoiceRequest["lines"][number] => ({
  kind: "free",
  descriptionAr: "كشف",
  descriptionEn: "Consultation",
  quantity: 1,
  unitPriceMinor: amount,
  discount: null,
});

/**
 * Demo money for every branch of a clinic with finance on (F2 card 1 §6): a partly paid invoice, a paid one,
 * and a paid then voided one whose payment became the patient's credit. Built only through the mock's own
 * writes, so every row, number, drawer position and audit entry is what the screens would make.
 *
 * @param db the freshly built state
 * @returns nothing; the state gains invoices, payments and credits
 */
export function seedFinanceDemo(db: MockState): void {
  const day = Date.now() - 3 * 86_400_000;
  let tick = 0;
  const at = () => new Date(day + tick++ * 60_000);
  for (const clinic of db.clinics) {
    if (!(db.features[clinic.id] ?? NO_FEATURES).finance) continue;
    const persona: Persona = { kind: "clinic_admin", clinicId: clinic.id, memberId: null };
    const a = guardFinance(db, persona);
    for (const branch of db.branches.filter((b) => b.clinicId === clinic.id && b.isActive)) {
      const patient = db.patients.find(
        (p) => p.clinicId === clinic.id && p.registrationBranchId === branch.id,
      );
      if (!patient) continue;
      const issue = (amount: string) =>
        issueInvoice(
          db,
          a,
          {
            source: "manual",
            sourceId: null,
            patientId: patient.id,
            branchId: branch.id,
            lines: [line(amount)],
            invoiceDiscount: null,
          },
          crypto.randomUUID(),
          at(),
        );
      const pay = (invoiceId: string, method: "cash" | "knet" | "bank_transfer", amount: string) =>
        recordPayment(
          db,
          persona,
          invoiceId,
          { method, amountMinor: amount },
          crypto.randomUUID(),
          at(),
        );
      const partly = issue("25000");
      pay(partly.id, "cash", "10000");
      const paid = issue("15000");
      pay(paid.id, "knet", "15000");
      const voided = issue("8000");
      pay(voided.id, "bank_transfer", "8000");
      voidInvoice(db, a, voided.id, voided.version, { reason: "خطأ في الإدخال" }, at());
    }
  }
}
