import type { Harness } from "../../identity/auth/__tests__/auth-http-harness.ts";
import { customRole, memberOn } from "../../identity/__tests__/user-fixtures.ts";
import type { AuthorizationInvalidator } from "../../identity/index.ts";
import {
  at,
  book,
  bookingBody,
  SUNDAY,
} from "../../appointments/__tests__/appointment-fixtures.ts";
import { send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { medicalClinic, setModule } from "../../medical/__tests__/medical-fixtures.ts";

/**
 * The medical clinic with the finance module on. The admin holds the seven clinic-scope finance keys from
 * the onboarding (system-roles.ts) and the doctor `view:invoices:own`; a price reader holds
 * `view:prices:clinic` only, and the desk (branch R) holds the receptionist's finance keys.
 */
export async function financeClinic(h: Harness, invalidate: AuthorizationInvalidator) {
  const C = await medicalClinic(h, invalidate);
  await setModule(h, invalidate, C.clinicId, "finance", true);
  const priceReader = await memberOn(
    h,
    C.admin,
    await customRole(h, C.clinicId, ["view:prices:clinic", "view:services:clinic"]),
  );
  const desk = await memberOn(
    h,
    C.admin,
    await customRole(h, C.clinicId, [
      "view:invoices:branch",
      "create:invoices:branch",
      "update:invoices:branch",
      "view:prices:clinic",
    ]),
    { allBranches: false, branchIds: [C.branchR] },
  );
  await invalidate.clinicChanged(C.clinicId);
  return { ...C, priceReader, desk };
}

export type FinanceClinic = Awaited<ReturnType<typeof financeClinic>>;

/** The clinic's audit rows written since `since`, oldest first. */
export const auditSince = (h: Harness, clinicId: string, since: Date) =>
  h.owner`SELECT action, category, entity_type, entity_id, details FROM audit_log
          WHERE clinic_id = ${clinicId} AND created_at >= ${since} ORDER BY created_at, id`;

/**
 * An appointment for the clinic's service on branch D with the doctor, booked and marked arrived by the
 * admin (so a visit can start from it).
 *
 * @returns the appointment's id
 */
export async function serviceAppointment(
  h: Harness,
  C: FinanceClinic,
  patientId: string,
  time: string,
): Promise<string> {
  const body = bookingBody(C, patientId, at(SUNDAY, time), { serviceId: C.serviceId });
  const res = await book(h, C.admin.cookie, body);
  if (res.statusCode !== 201) throw new Error(`book ${res.statusCode} ${res.body}`);
  const id = (res.json() as { appointment: { id: string } }).appointment.id;
  const arrived = await send(h, C.admin.cookie, "POST", `/v1/appointments/${id}/status`, {
    status: "arrived",
  });
  if (arrived.statusCode !== 200) throw new Error(`arrive ${arrived.statusCode} ${arrived.body}`);
  return id;
}
