import { isBillable, type AppointmentStatus } from "@eyadex/contracts/appointments";
import {
  createInvoiceRequestSchema,
  updateInvoiceRequestSchema,
  voidInvoiceRequestSchema,
  type CreateInvoiceRequest,
  type Invoice,
  type InvoiceDraft,
} from "@eyadex/contracts/finance";
import { ApiError, financeError } from "../api-error";
import { holdsWrite, seesInvoice, writeReaches, type FinanceAccess } from "./mock-finance-access";
import {
  clinicFinanceOf,
  clinicMonth,
  effectivePrice,
  exponentOf,
  financeState,
  type StoredInvoice,
} from "./mock-finance-state";
import {
  carriesDiscount,
  checkServiceLines,
  discountsKey,
  formatInvoiceNumber,
  storedLines,
  totalsFields,
  totalsOf,
} from "./mock-invoice-rules";
import { actorReplayKey, requireIdempotencyKey } from "./mock-idempotency";
import { auditInvoice } from "./mock-finance-audit";
import { editedMeta, issuedMeta } from "./mock-discount-authors";
import { releaseOnChange } from "./mock-invoice-releases";
import { strip } from "./mock-invoice-view";
import { parse } from "./mock-medical-access";
import { inPatientViewReach } from "./mock-patient-rules";
import { settlementOf } from "./mock-settlement";
import { newId, type MockState } from "./mock-store";

/** Who and where an appointment or visit names, or not_found outside the clinic. */
function sourceOf(db: MockState, clinicId: string, source: "appointment" | "visit", id: string) {
  const row =
    source === "appointment"
      ? db.appointments.find((x) => x.id === id && x.clinicId === clinicId)
      : db.medical.visits.find((x) => x.id === id && x.clinicId === clinicId);
  if (!row) throw new ApiError("not_found");
  const appointment =
    source === "appointment"
      ? (row as (typeof db.appointments)[number])
      : db.appointments.find(
          (x) => x.id === (row as { appointmentId: string | null }).appointmentId,
        );
  return {
    patientId: row.patientId,
    branchId: row.branchId,
    serviceId: appointment?.serviceId ?? null,
    providerId: row.providerMembershipId,
    // A visit happened, so its appointment's status does not decide whether it is billed.
    status: source === "appointment" ? (appointment?.status ?? null) : null,
  };
}

/** After the reach check (unreachable stays not_found): a no-show or cancelled appointment
 * carries no invoice of its own (FIN-9); its fee is a manual invoice. */
function requireBillable(s: { status: AppointmentStatus | null }) {
  if (s.status !== null && !isBillable(s.status)) throw new ApiError("appointment_not_billable");
}

/** GET /v1/invoices/draft: the source's service at the effective price, or "0" with priceMissing. */
export function draftOf(
  db: MockState,
  a: FinanceAccess,
  source: "appointment" | "visit",
  id: string,
): InvoiceDraft {
  if (!holdsWrite(a, "create")) throw new ApiError("forbidden");
  const s = sourceOf(db, a.clinic.id, source, id);
  if (!writeReaches(a, "create", "invoices", s.branchId)) throw new ApiError("not_found");
  requireBillable(s);
  refuseBilledEncounter(db, a.clinic.id, source, id);
  const price = s.serviceId ? effectivePrice(db, s.serviceId, s.providerId) : null;
  return {
    source,
    sourceId: id,
    patientId: s.patientId,
    branchId: s.branchId,
    priceMissing: s.serviceId !== null && price === null,
    lines: s.serviceId
      ? [
          {
            kind: "service",
            serviceId: s.serviceId,
            providerId: s.providerId,
            quantity: 1,
            unitPriceMinor: price ?? "0",
            discount: null,
          },
        ]
      : [],
  };
}

/**
 * As the API: one encounter is billed once. An appointment and the visit made from it are two sources of
 * it, so a live invoice on either answers invoice_already_exists, in the draft and the issue.
 */
function refuseBilledEncounter(
  db: MockState,
  clinicId: string,
  source: "appointment" | "visit",
  sourceId: string,
) {
  const visit = (id: string) =>
    db.medical.visits.find((v) => v.id === id && v.clinicId === clinicId);
  const encounter =
    source === "appointment"
      ? [
          `appointment:${sourceId}`,
          ...db.medical.visits
            .filter((v) => v.clinicId === clinicId && v.appointmentId === sourceId)
            .map((v) => `visit:${v.id}`),
        ]
      : [`visit:${sourceId}`, `appointment:${visit(sourceId)?.appointmentId ?? "-"}`];
  const billed = financeState(db).invoices.some(
    (i) =>
      i.clinicId === clinicId &&
      i.status !== "void" &&
      encounter.includes(`${i.source}:${i.sourceId}`),
  );
  if (billed) throw new ApiError("invoice_already_exists");
}

function parties(db: MockState, a: FinanceAccess, body: CreateInvoiceRequest) {
  const named =
    body.source === "manual"
      ? { patientId: body.patientId!, branchId: body.branchId! }
      : sourceOf(db, a.clinic.id, body.source, body.sourceId!);
  const patient = db.patients.find((p) => p.id === named.patientId && p.clinicId === a.clinic.id);
  const branch = db.branches.find((b) => b.id === named.branchId && b.clinicId === a.clinic.id);
  if (!patient || !branch || !branch.isActive) throw new ApiError("not_found");
  // As the API (R1-7, ISO-02): outside the caller's write reach is not_found, and a manual invoice also
  // needs the patient inside the caller's patients view reach (an appointment or visit already names it).
  if (!writeReaches(a, "create", "invoices", branch.id)) throw new ApiError("not_found");
  if (body.source === "manual" && !inPatientViewReach(db, a, patient.id)) {
    throw new ApiError("not_found");
  }
  if ("status" in named) requireBillable(named);
  return named;
}

/** POST /v1/invoices (spec §3.2, §8 rules 7–9): a refused issue never takes a number. */
export function issueInvoice(
  db: MockState,
  a: FinanceAccess,
  raw: unknown,
  key: string,
  now: Date,
): Invoice {
  if (!holdsWrite(a, "create")) throw new ApiError("forbidden");
  requireIdempotencyKey(key);
  const body = parse(createInvoiceRequestSchema, raw);
  const state = financeState(db);
  const ledgerKey = actorReplayKey(a.clinic.id, a.member.id, key);
  const fingerprint = JSON.stringify(body);
  const previous = state.idempotentInvoices[ledgerKey];
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new ApiError("idempotency_conflict");
    const first = state.invoices.find((i) => i.id === previous.invoiceId)!;
    // As the API: the first answer is given again only while its branch is still in the caller's reach.
    if (!writeReaches(a, "create", "invoices", first.branchId)) throw new ApiError("not_found");
    return strip(db, first);
  }
  const { patientId, branchId } = parties(db, a, body);
  if (
    carriesDiscount(body.lines, body.invoiceDiscount) &&
    !writeReaches(a, "create", "discounts", branchId)
  ) {
    throw new ApiError("forbidden");
  }
  if (body.source !== "manual") refuseBilledEncounter(db, a.clinic.id, body.source, body.sourceId!);
  const prefix = state.prefixes[branchId];
  if (!prefix) throw new ApiError("invoice_prefix_missing");
  checkServiceLines(db, a.clinic.id, body.lines);
  const finance = clinicFinanceOf(db, a.clinic.id);
  const totals = totalsOf(body.lines, body.invoiceDiscount, finance.taxRateBp);
  const year = Number(clinicMonth(now.toISOString(), a.clinic.timezone).slice(0, 4));
  const counterKey = `${branchId}:${year}`;
  const seq = (state.counters[counterKey] ?? 0) + 1;
  state.counters[counterKey] = seq;
  state.usedPrefixes[`${a.clinic.id}:${prefix}`] = branchId;
  const invoice: StoredInvoice = {
    clinicId: a.clinic.id,
    id: newId(),
    number: formatInvoiceNumber(prefix, year, seq),
    status: "issued",
    source: body.source,
    sourceId: body.sourceId,
    branchId,
    patientId,
    issuedAt: now.toISOString(),
    currency: finance.currency,
    currencyExponent: exponentOf(finance.currency),
    taxRateBp: finance.taxRateBp,
    ...totalsFields(totals),
    invoiceDiscount: body.invoiceDiscount,
    lines: storedLines(db, body.lines, totals),
    voidReason: null,
    voidedAt: null,
    version: 1,
    ...issuedMeta(body, a.member.id, now.toISOString(), a.clinic.timezone),
  };
  state.invoices.push(invoice);
  state.idempotentInvoices[ledgerKey] = { invoiceId: invoice.id, fingerprint };
  const answer = strip(db, invoice);
  auditInvoice(db, a, "invoice.issued", null, answer);
  return answer;
}

/** The invoice for a write: hidden → not_found, seen but out of write reach → forbidden. */
function lockedInvoice(
  db: MockState,
  a: FinanceAccess,
  id: string,
  action: "update" | "deactivate",
  version: number,
): StoredInvoice {
  if (!holdsWrite(a, action)) throw new ApiError("forbidden");
  const invoice = financeState(db).invoices.find((i) => i.id === id && i.clinicId === a.clinic.id);
  if (!invoice || !seesInvoice(db, a, invoice)) throw new ApiError("not_found");
  if (!writeReaches(a, action, "invoices", invoice.branchId)) throw new ApiError("forbidden");
  if (invoice.status === "void") throw new ApiError("invoice_void");
  if (!Number.isInteger(version) || version < 1) throw new ApiError("precondition_required");
  if (invoice.version !== version) throw new ApiError("version_conflict");
  return invoice;
}

/** PATCH /v1/invoices/:id with If-Match: lines and discounts; the number and tax rate stay. */
export function editInvoice(
  db: MockState,
  a: FinanceAccess,
  id: string,
  version: number,
  raw: unknown,
): Invoice {
  const invoice = lockedInvoice(db, a, id, "update", version);
  const body = parse(updateInvoiceRequestSchema, raw);
  if (
    discountsKey(invoice.lines, invoice.invoiceDiscount) !==
      discountsKey(body.lines, body.invoiceDiscount) &&
    !writeReaches(a, "create", "discounts", invoice.branchId)
  ) {
    throw new ApiError("forbidden");
  }
  checkServiceLines(db, a.clinic.id, body.lines, invoice.lines);
  const totals = totalsOf(body.lines, body.invoiceDiscount, invoice.taxRateBp);
  const before = strip(db, invoice);
  const auditCredits = releaseOnChange(db, a, invoice, totals.totalMinor);
  Object.assign(invoice, {
    ...editedMeta(invoice, body, a.member.id),
    ...totalsFields(totals),
    invoiceDiscount: body.invoiceDiscount,
    lines: storedLines(db, body.lines, totals),
    version: invoice.version + 1,
  });
  const after = strip(db, invoice);
  auditInvoice(db, a, "invoice.edited", before, after);
  auditCredits();
  return after;
}

/** POST /v1/invoices/:id/void: the number stays taken, the source can be invoiced again. */
export function voidInvoice(
  db: MockState,
  a: FinanceAccess,
  id: string,
  version: number,
  raw: unknown,
  now: Date,
): Invoice {
  const invoice = lockedInvoice(db, a, id, "deactivate", version);
  const body = parse(voidInvoiceRequestSchema, raw);
  // As the API (issue #113): the amount the user confirmed must still be the invoice's paid amount,
  // so money paid since that read never becomes the patient's credit unseen. Judged before any write.
  if (body.expectedPaidMinor !== undefined) {
    const paid = settlementOf(db, invoice)?.paidMinor ?? "0";
    if (BigInt(body.expectedPaidMinor) !== BigInt(paid)) throw financeError("invoice_paid_changed");
  }
  const before = strip(db, invoice);
  const auditCredits = releaseOnChange(db, a, invoice, "void", now);
  Object.assign(invoice, {
    status: "void",
    voidReason: body.reason,
    voidedAt: now.toISOString(),
    version: invoice.version + 1,
  });
  const after = strip(db, invoice);
  auditInvoice(db, a, "invoice.voided", before, after);
  auditCredits();
  return after;
}
