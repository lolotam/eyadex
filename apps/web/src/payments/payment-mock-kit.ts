/** Mock test kit of the payments area: invoices to pay, personas, refusals and the money invariants. */
import type { CreateInvoiceRequest, Invoice, PaymentMethod } from "@eyadex/contracts/finance";
import type { Persona } from "@eyadex/contracts/session";
import { settlementBreaches } from "@eyadex/contracts/settlement";
import { errorKeyOf } from "@/shared/api/api-error";
import { financeState } from "@/shared/api/mock/mock-finance-state";
import { moneyOf } from "@/shared/api/mock/mock-payment-state";
import { settlementInvoice } from "@/shared/api/mock/mock-settlement";
import { api, as, clinicIdAt, getState } from "@/shared/api/mock/mock-test-kit";

export { api, as, clinicIdAt, getState };
export const admin = (): Persona => as("clinic_admin");

const SUCCEEDED = Symbol("succeeded");

/** The error key of a refusal; a success fails the test instead of passing as "unknown". */
export async function refusal(p: Promise<unknown>): Promise<string> {
  const result = await p.then(
    () => SUCCEEDED,
    (e: unknown) => e,
  );
  if (result === SUCCEEDED) throw new Error("expected a refusal");
  return errorKeyOf(result);
}

export const clinicPatients = () => getState().patients.filter((p) => p.clinicId === clinicIdAt(0));

export function patientAt(index = 0) {
  const p = clinicPatients()[index];
  if (!p) throw new Error("seed");
  return p;
}

export const freeLine = (amount: string): CreateInvoiceRequest["lines"][number] => ({
  kind: "free",
  descriptionAr: "بند",
  descriptionEn: "Item",
  quantity: 1,
  unitPriceMinor: amount,
  discount: null,
});

export function issue(
  amount: string,
  patient: { id: string; registrationBranchId: string } = patientAt(),
  branchId = patient.registrationBranchId,
): Promise<Invoice> {
  return api.finance.issue(
    admin(),
    {
      source: "manual",
      sourceId: null,
      patientId: patient.id,
      branchId,
      lines: [freeLine(amount)],
      invoiceDiscount: null,
    },
    crypto.randomUUID(),
  );
}

export const pay = (
  invoiceId: string,
  amountMinor: string,
  method: PaymentMethod = "cash",
  persona: Persona = admin(),
  key: string = crypto.randomUUID(),
) => api.payments.recordPayment(persona, invoiceId, { method, amountMinor }, key);

export const applyCredit = (
  invoiceId: string,
  amountMinor: string,
  persona: Persona = admin(),
  key: string = crypto.randomUUID(),
) => api.payments.applyCredit(persona, invoiceId, { amountMinor }, key);

export async function editTotal(invoiceId: string, amount: string): Promise<Invoice> {
  const current = await api.finance.getInvoice(admin(), invoiceId);
  return api.finance.edit(admin(), invoiceId, current.version, {
    lines: [freeLine(amount)],
    invoiceDiscount: null,
  });
}

export async function voidIt(invoiceId: string): Promise<Invoice> {
  const current = await api.finance.getInvoice(admin(), invoiceId);
  return api.finance.voidInvoice(admin(), invoiceId, current.version, "اختبار");
}

/** The seeded system role and one active member holding it, to narrow keys or branches in a test. */
export function roleOf(kind: "receptionist" | "doctor" | "technician") {
  const db = getState();
  const role = db.roles.find((r) => r.clinicId === clinicIdAt(0) && r.systemKey === kind);
  const member = db.members.find((m) => m.roleId === role?.id && m.status === "active");
  if (!role || !member) throw new Error("seed");
  return { role, member };
}

/** The §4.3 invariants hold for a patient (0066's `finance_check_patient`): no breach at all. */
export function breachesOf(patientId: string): string[] {
  const db = getState();
  const invoices = financeState(db)
    .invoices.filter((i) => i.clinicId === clinicIdAt(0) && i.patientId === patientId)
    .map(settlementInvoice);
  return settlementBreaches(moneyOf(db, clinicIdAt(0), patientId), invoices);
}

export const auditOf = (action: string) =>
  getState().clinicAudit.filter((e) => e.clinicId === clinicIdAt(0) && e.action === action);
