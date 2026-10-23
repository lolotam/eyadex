import { paymentListQuerySchema, type Payment } from "@eyadex/contracts/finance";
import { optionListQuerySchema, type BranchOptionListResponse } from "@eyadex/contracts/role-admin";
import type { Persona } from "@eyadex/contracts/session";
import { creditBalance, paymentRefundable } from "@eyadex/contracts/settlement";
import { ApiError } from "../api-error";
import type { InvoicePayments, PaymentList } from "../payments-client";
import { parse } from "./mock-medical-access";
import { paymentsReach, reachableInvoice, requirePayments } from "./mock-payment-access";
import { moneyOf, paymentState, type StoredPayment } from "./mock-payment-state";
import { settlementOf } from "./mock-settlement";
import type { MockState } from "./mock-store";

/**
 * The receipt as the API answers it, with the patient's display name read beside it: a name read, not a
 * file open, so no patient-access row (as the invoice list). A missing patient is `unknown`, as the API.
 */
export function paymentView(db: MockState, p: StoredPayment): Payment {
  const { clinicId, ...rest } = p;
  const patient = db.patients.find((x) => x.clinicId === clinicId && x.id === p.patientId);
  if (!patient) throw new ApiError("unknown");
  return { ...rest, patientName: patient.fullName };
}

/** GET /v1/invoices/:id/payments: needs `view:payments` reaching the invoice's branch (F2-Q8). */
export function invoicePayments(
  db: MockState,
  persona: Persona,
  invoiceId: string,
): InvoicePayments {
  const a = requirePayments(db, persona, "view");
  const invoice = reachableInvoice(db, a, invoiceId, "view");
  const s = paymentState(db);
  const money = moneyOf(db, invoice.clinicId, invoice.patientId);
  const onInvoice = new Set(
    s.allocations
      .filter((x) => x.clinicId === invoice.clinicId && x.invoiceId === invoice.id)
      .map((x) => x.id),
  );
  const movements: InvoicePayments["movements"] = [
    ...s.payments
      .filter((p) => p.clinicId === invoice.clinicId && p.invoiceId === invoice.id)
      .map((p) => ({
        kind: "payment" as const,
        paymentId: p.id,
        receiptNumber: p.receiptNumber,
        method: p.method,
        amountMinor: p.amountMinor,
        refundableMinor: String(paymentRefundable(money, p.id)),
        at: p.receivedAt,
        by: p.receivedBy,
      })),
    ...s.allocations
      .filter((x) => onInvoice.has(x.id) && x.creditId !== null)
      .map((x) => ({
        kind: "credit_applied" as const,
        allocationId: x.id,
        creditId: x.creditId!,
        amountMinor: x.amountMinor,
        at: x.createdAt,
        by: x.by,
      })),
    ...s.credits
      .filter((c) => c.clinicId === invoice.clinicId && onInvoice.has(c.originAllocationId))
      .map((c) => ({
        kind: "credit_released" as const,
        creditId: c.id,
        originAllocationId: c.originAllocationId,
        amountMinor: c.amountMinor,
        cause: c.cause,
        at: c.createdAt,
        by: c.by,
      })),
  ].sort((x, y) => x.at.localeCompare(y.at));
  return {
    invoiceId: invoice.id,
    currency: invoice.currency,
    currencyExponent: invoice.currencyExponent,
    settlement: settlementOf(db, invoice),
    creditBalanceMinor: String(creditBalance(money)),
    movements,
  };
}

/** GET /v1/payments: newest first, cursor pages, only receipts of branches the view key reaches. */
export function listPayments(db: MockState, persona: Persona, raw: unknown): PaymentList {
  const a = requirePayments(db, persona, "view");
  const q = parse(paymentListQuerySchema, raw);
  const rows = paymentState(db)
    .payments.filter(
      (p) =>
        p.clinicId === a.clinic.id &&
        paymentsReach(a, "view", p.branchId) &&
        (!q.branchId || p.branchId === q.branchId) &&
        (!q.method || p.method === q.method) &&
        (!q.patientId || p.patientId === q.patientId) &&
        (!q.invoiceId || p.invoiceId === q.invoiceId) &&
        (!q.from || p.businessDate >= q.from) &&
        (!q.to || p.businessDate <= q.to) &&
        (!q.receiptNumber || p.receiptNumber.includes(q.receiptNumber.toUpperCase())),
    )
    .sort((x, y) => y.receivedAt.localeCompare(x.receivedAt) || y.id.localeCompare(x.id));
  const start = q.cursor ? rows.findIndex((r) => r.id === q.cursor) + 1 : 0;
  const page = rows.slice(start, start + q.limit);
  return {
    items: page.map((p) => paymentView(db, p)),
    nextCursor: start + q.limit < rows.length ? (page[page.length - 1]?.id ?? null) : null,
    total: rows.length,
  };
}

/** GET /v1/payments/:id: a receipt outside the view key's reach is not_found. */
export function getPayment(db: MockState, persona: Persona, paymentId: string): Payment {
  const a = requirePayments(db, persona, "view");
  const p = paymentState(db).payments.find((x) => x.id === paymentId && x.clinicId === a.clinic.id);
  if (!p || !paymentsReach(a, "view", p.branchId)) throw new ApiError("not_found");
  return paymentView(db, p);
}

/** GET /v1/payments/branch-options: the payment guards, then only the branches the view key reaches. */
export function branchOptions(
  db: MockState,
  persona: Persona,
  raw: unknown,
): BranchOptionListResponse {
  const a = requirePayments(db, persona, "view");
  const q = parse(optionListQuerySchema, raw);
  // The API's cursor: the last id without dashes, ids in order (list-cursor.ts); anything else is refused.
  const after = q.cursor ? cursorId(q.cursor) : null;
  const rows = db.branches
    .filter((b) => b.clinicId === a.clinic.id && paymentsReach(a, "view", b.id))
    .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const rest = after ? rows.filter((r) => r.id > after) : rows;
  const page = rest.slice(0, q.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((b) => ({
      id: b.id,
      nameAr: b.nameAr,
      nameEn: b.nameEn,
      isActive: b.isActive,
    })),
    nextCursor: rest.length > q.limit && last ? last.id.replaceAll("-", "") : null,
    total: rows.length,
  };
}

function cursorId(cursor: string): string {
  if (!/^[0-9a-f]{32}$/.test(cursor)) throw new ApiError("validation");
  const at = [8, 12, 16, 20];
  return [0, ...at].map((start, i) => cursor.slice(start, at[i])).join("-");
}
