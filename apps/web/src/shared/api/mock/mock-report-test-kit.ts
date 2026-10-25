/** Mock test kit of the F3 reports: money to report on, personas with narrowed keys, refusals. */
import { dayInTimeZone } from "@eyadex/contracts/audit";
import type { CreateInvoiceRequest, Invoice } from "@eyadex/contracts/finance";
import type { Persona } from "@eyadex/contracts/session";
import { errorKeyOf } from "../api-error";
import { api, as, clinicIdAt, getState } from "./mock-test-kit";

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

export const clinic = () => getState().clinics.find((c) => c.id === clinicIdAt(0))!;
/** Today in the clinic's time zone: the range every write of a test lands in. */
export const today = () => dayInTimeZone(new Date().toISOString(), clinic().timezone);
export const range = () => ({ from: today(), to: today() });

export function patientAt(index = 0) {
  const p = getState().patients.filter((x) => x.clinicId === clinicIdAt(0))[index];
  if (!p) throw new Error("seed");
  return p;
}

type Line = CreateInvoiceRequest["lines"][number];
export const freeLine = (amount: string, discount: Line["discount"] = null): Line => ({
  kind: "free",
  descriptionAr: "بند",
  descriptionEn: "Item",
  quantity: 1,
  unitPriceMinor: amount,
  discount,
});

export function issue(
  lines: Line[],
  patient = patientAt(),
  invoiceDiscount: CreateInvoiceRequest["invoiceDiscount"] = null,
  persona: Persona = admin(),
): Promise<Invoice> {
  return api.finance.issue(
    persona,
    {
      source: "manual",
      sourceId: null,
      patientId: patient.id,
      branchId: patient.registrationBranchId,
      lines,
      invoiceDiscount,
    },
    crypto.randomUUID(),
  );
}

export const pay = (invoiceId: string, amountMinor: string) =>
  api.payments.recordPayment(admin(), invoiceId, { method: "cash", amountMinor }, crypto.randomUUID());

/** A custom role holding exactly these keys, on a fresh member of the clinic; the persona that uses it. */
export function personaWith(keys: string[], branchIds: string[] | null = null): Persona {
  const db = getState();
  const base = db.members.find((m) => m.clinicId === clinicIdAt(0) && m.status === "active")!;
  const roleId = crypto.randomUUID();
  const role = db.roles.find((r) => r.id === base.roleId)!;
  db.roles.push({ ...role, id: roleId, systemKey: null, isLocked: false, permissions: keys });
  const memberId = crypto.randomUUID();
  db.members.push({
    ...base,
    id: memberId,
    roleId,
    allBranches: branchIds === null,
    branchIds: branchIds ?? [],
  });
  return { kind: "custom", clinicId: clinicIdAt(0), memberId };
}

/** The seeded member a system persona resolves to. */
export function memberOf(kind: "clinic_admin" | "doctor" | "receptionist") {
  const db = getState();
  const role = db.roles.find((r) => r.clinicId === clinicIdAt(0) && r.systemKey === kind);
  const member = db.members.find((m) => m.roleId === role?.id && m.status === "active");
  if (!member) throw new Error("seed");
  return member;
}
