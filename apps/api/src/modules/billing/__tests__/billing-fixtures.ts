import { randomUUID } from "node:crypto";

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
import { medicalClinic, patientIn, setModule } from "../../medical/__tests__/medical-fixtures.ts";

/**
 * The medical clinic with the finance module on. The admin holds the seven clinic-scope finance keys from
 * the onboarding (system-roles.ts) and the doctor `view:invoices:own`; a price reader holds
 * `view:prices:clinic` only, and the desk (branch R) holds the receptionist's finance keys.
 *
 * Finance F2 (F2-Q15) adds the receptionist: a member of branch R that records the payments of its branch
 * (the four keys of §4.1) and holds no other finance key.
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
      "view:patients:branch",
      "view:invoices:branch",
      "create:invoices:branch",
      "update:invoices:branch",
      "view:prices:clinic",
    ]),
    { allBranches: false, branchIds: [C.branchR] },
  );
  const receptionist = await memberOn(
    h,
    C.admin,
    await customRole(h, C.clinicId, [
      "view:patients:branch",
      "view:invoices:branch",
      "view:payments:branch",
      "create:payments:branch",
    ]),
    { allBranches: false, branchIds: [C.branchR] },
  );
  await invalidate.clinicChanged(C.clinicId);
  return { ...C, priceReader, desk, receptionist };
}

export type FinanceClinic = Awaited<ReturnType<typeof financeClinic>>;

/** A fictional Arabic display name stored directly for invoice read assertions. */
export async function namedPatient(h: Harness, C: FinanceClinic, branchId: string, name: string) {
  const id = await patientIn(h, C, branchId);
  await h.owner`UPDATE patients SET full_name = ${name} WHERE clinic_id = ${C.clinicId} AND id = ${id}`;
  return id;
}

/** The clinic's audit rows written since `since`, oldest first. */
export const auditSince = (h: Harness, clinicId: string, since: Date) =>
  h.owner`SELECT action, category, entity_type, entity_id, details FROM audit_log
          WHERE clinic_id = ${clinicId} AND created_at >= ${since} ORDER BY created_at, id`;

/**
 * An appointment for the clinic's service on branch D with the doctor, booked by the admin and moved to
 * `status`: arrived by default (so a visit can start from it), or a no-show or a cancel.
 *
 * @returns the appointment's id
 */
export async function serviceAppointment(
  h: Harness,
  C: FinanceClinic,
  patientId: string,
  time: string,
  status: "arrived" | "no_show" | "cancelled" = "arrived",
): Promise<string> {
  const body = bookingBody(C, patientId, at(SUNDAY, time), { serviceId: C.serviceId });
  const res = await book(h, C.admin.cookie, body);
  if (res.statusCode !== 201) throw new Error(`book ${res.statusCode} ${res.body}`);
  const id = (res.json() as { appointment: { id: string } }).appointment.id;
  const moved =
    status === "cancelled"
      ? await send(h, C.admin.cookie, "POST", `/v1/appointments/${id}/cancel`, {
          reason: "patient_cancelled",
          note: null,
        })
      : await send(h, C.admin.cookie, "POST", `/v1/appointments/${id}/status`, { status });
  if (moved.statusCode !== 200) throw new Error(`${status} ${moved.statusCode} ${moved.body}`);
  return id;
}

/** Gives branches D and R their invoice prefixes (the branch form comes with plan Task 8h). */
export async function setPrefixes(h: Harness, C: FinanceClinic): Promise<void> {
  await h.owner`UPDATE branches SET invoice_prefix = 'SLMD' WHERE id = ${C.branchD}`;
  await h.owner`UPDATE branches SET invoice_prefix = 'SLMR' WHERE id = ${C.branchR}`;
}

/**
 * A manual invoice of one free line, issued by `cookie`.
 *
 * @returns the invoice's id and number
 */
export async function manualInvoice(
  h: Harness,
  cookie: string,
  patientId: string,
  branchId: string,
  unitPriceMinor = "1000",
): Promise<{ id: string; number: string }> {
  const line = {
    kind: "free",
    descriptionAr: "جلسة",
    descriptionEn: "Session",
    quantity: 1,
    unitPriceMinor,
    discount: null,
  };
  const res = await send(
    h,
    cookie,
    "POST",
    "/v1/invoices",
    { source: "manual", sourceId: null, patientId, branchId, lines: [line], invoiceDiscount: null },
    randomUUID(),
  );
  if (res.statusCode !== 201) throw new Error(`issue ${res.statusCode} ${res.body}`);
  return (res.json() as { invoice: { id: string; number: string } }).invoice;
}

/**
 * POST /v1/invoices/:id/payments as `cookie`, with the idempotency key (a fresh one by default).
 *
 * @returns the response of the API, untouched
 */
export async function pay(
  h: Harness,
  cookie: string,
  invoiceId: string,
  body: { method: string; amountMinor: string; reference?: string },
  key = randomUUID(),
) {
  return send(h, cookie, "POST", `/v1/invoices/${invoiceId}/payments`, body, key);
}

/**
 * POST /v1/invoices/:id/credit-applications as `cookie`, with the idempotency key (a fresh one by default).
 *
 * @returns the response of the API, untouched
 */
export async function applyCredit(
  h: Harness,
  cookie: string,
  invoiceId: string,
  amountMinor: string,
  key = randomUUID(),
) {
  return send(
    h,
    cookie,
    "POST",
    `/v1/invoices/${invoiceId}/credit-applications`,
    { amountMinor },
    key,
  );
}

/**
 * POST /v1/invoices/:id/refunds as `cookie`, with the idempotency key (a fresh one by default).
 *
 * @returns the response of the API, untouched
 */
export async function refund(
  h: Harness,
  cookie: string,
  invoiceId: string,
  body: Record<string, unknown>,
  key = randomUUID(),
) {
  return send(h, cookie, "POST", `/v1/invoices/${invoiceId}/refunds`, body, key);
}

/**
 * Finance F2 slice 5 (F2-Q15): two members of branch R beside the receptionist — the refunder gives money back
 * from the invoices of its branch, and the closer closes its branch's cash drawer. Neither holds another
 * finance key, so each spec proves one key at a time.
 */
export async function moneyStaff(
  h: Harness,
  C: FinanceClinic,
  invalidate: AuthorizationInvalidator,
) {
  const branchR = { allBranches: false, branchIds: [C.branchR] };
  const refunder = await memberOn(
    h,
    C.admin,
    await customRole(h, C.clinicId, [
      "view:patients:branch",
      "view:invoices:branch",
      "view:payments:branch",
      "create:refunds:branch",
    ]),
    branchR,
  );
  const closer = await memberOn(
    h,
    C.admin,
    await customRole(h, C.clinicId, ["view:cash_closings:branch", "create:cash_closings:branch"]),
    branchR,
  );
  await invalidate.clinicChanged(C.clinicId);
  return { refunder, closer };
}

/** GET /v1/cash-closings/preview for one branch, as `cookie`. */
export const previewClosing = (h: Harness, cookie: string, branchId: string) =>
  send(h, cookie, "GET", `/v1/cash-closings/preview?branchId=${branchId}`);

/**
 * POST /v1/cash-closings as `cookie`, with the idempotency key (a fresh one by default).
 *
 * @returns the response of the API, untouched
 */
export async function closeCash(
  h: Harness,
  cookie: string,
  body: Record<string, unknown>,
  key = randomUUID(),
) {
  return send(h, cookie, "POST", "/v1/cash-closings", body, key);
}
