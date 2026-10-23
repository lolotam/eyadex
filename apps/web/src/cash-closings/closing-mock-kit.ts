/** Mock test kit of the cash closings: a paid invoice to move the drawer, personas and refusals. */
import type { PaymentMethod } from "@eyadex/contracts/finance";
import type { Persona } from "@eyadex/contracts/session";
import { errorKeyOf } from "@/shared/api/api-error";
import { api, as, clinicIdAt, getState } from "@/shared/api/mock/mock-test-kit";

export { api, as };
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

export const issue = (amount: string, patient = patientAt()) =>
  api.finance.issue(
    admin(),
    {
      source: "manual",
      sourceId: null,
      patientId: patient.id,
      branchId: patient.registrationBranchId,
      lines: [
        {
          kind: "free",
          descriptionAr: "بند",
          descriptionEn: "Item",
          quantity: 1,
          unitPriceMinor: amount,
          discount: null,
        },
      ],
      invoiceDiscount: null,
    },
    crypto.randomUUID(),
  );

export const pay = (invoiceId: string, amountMinor: string, method: PaymentMethod = "cash") =>
  api.payments.recordPayment(admin(), invoiceId, { method, amountMinor }, crypto.randomUUID());

/** A seeded system role and one active member holding it, to narrow keys or branches in a test. */
export function roleOf(kind: "receptionist") {
  const db = getState();
  const role = db.roles.find((r) => r.clinicId === clinicIdAt(0) && r.systemKey === kind);
  const member = db.members.find((m) => m.roleId === role?.id && m.status === "active");
  if (!role || !member) throw new Error("seed");
  return { role, member };
}

export const auditOf = (action: string) =>
  getState().clinicAudit.filter((e) => e.clinicId === clinicIdAt(0) && e.action === action);
