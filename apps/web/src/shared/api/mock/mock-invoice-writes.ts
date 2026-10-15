import {
  createInvoiceRequestSchema,
  updateInvoiceRequestSchema,
  voidInvoiceRequestSchema,
  type CreateInvoiceRequest,
  type Invoice,
  type InvoiceDraft,
} from "@eyadex/contracts/finance";
import { ApiError } from "../api-error";
import { holdsWrite, seesInvoice, writeReaches, type FinanceAccess } from "./mock-finance-access";
import {
  clinicFinanceOf,
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
import { parse } from "./mock-medical-access";
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
      : db.appointments.find((x) => x.id === (row as { appointmentId: string | null }).appointmentId);
  return {
    patientId: row.patientId,
    branchId: row.branchId,
    serviceId: appointment?.serviceId ?? null,
    providerId: row.providerMembershipId,
  };
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

const liveInvoiceOf = (db: MockState, clinicId: string, source: string, sourceId: string) =>
  financeState(db).invoices.find(
    (i) =>
      i.clinicId === clinicId && i.source === source && i.sourceId === sourceId && i.status !== "void",
  );

function parties(db: MockState, a: FinanceAccess, body: CreateInvoiceRequest) {
  const named =
    body.source === "manual"
      ? { patientId: body.patientId!, branchId: body.branchId! }
      : sourceOf(db, a.clinic.id, body.source, body.sourceId!);
  const patient = db.patients.find((p) => p.id === named.patientId && p.clinicId === a.clinic.id);
  const branch = db.branches.find((b) => b.id === named.branchId && b.clinicId === a.clinic.id);
  if (!patient || !branch || !branch.isActive) throw new ApiError("not_found");
  if (!writeReaches(a, "create", "invoices", branch.id)) throw new ApiError("forbidden");
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
    return strip(state.invoices.find((i) => i.id === previous.invoiceId)!);
  }
  const { patientId, branchId } = parties(db, a, body);
  if (carriesDiscount(body.lines, body.invoiceDiscount) && !writeReaches(a, "create", "discounts", branchId)) {
    throw new ApiError("forbidden");
  }
  if (body.sourceId !== null && liveInvoiceOf(db, a.clinic.id, body.source, body.sourceId)) {
    throw new ApiError("invoice_already_exists");
  }
  const prefix = state.prefixes[branchId];
  if (!prefix) throw new ApiError("invoice_prefix_missing");
  checkServiceLines(db, a.clinic.id, body.lines);
  const finance = clinicFinanceOf(db, a.clinic.id);
  const totals = totalsOf(body.lines, body.invoiceDiscount, finance.taxRateBp);
  const year = now.getUTCFullYear();
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
  };
  state.invoices.push(invoice);
  state.idempotentInvoices[ledgerKey] = { invoiceId: invoice.id, fingerprint };
  return strip(invoice);
}

export function strip(invoice: StoredInvoice): Invoice {
  const { clinicId: _c, ...rest } = invoice;
  void _c;
  return rest;
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
  checkServiceLines(db, a.clinic.id, body.lines);
  const totals = totalsOf(body.lines, body.invoiceDiscount, invoice.taxRateBp);
  Object.assign(invoice, {
    ...totalsFields(totals),
    invoiceDiscount: body.invoiceDiscount,
    lines: storedLines(db, body.lines, totals),
    version: invoice.version + 1,
  });
  return strip(invoice);
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
  Object.assign(invoice, {
    status: "void",
    voidReason: body.reason,
    voidedAt: now.toISOString(),
    version: invoice.version + 1,
  });
  return strip(invoice);
}
