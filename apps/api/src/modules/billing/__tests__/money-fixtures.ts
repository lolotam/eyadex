import { randomUUID } from "node:crypto";

import { expect } from "vitest";

import { APP, call, type Harness } from "../../identity/auth/__tests__/auth-http-harness.ts";
import type { Clock } from "../../tenancy/index.ts";
import {
  closeCash,
  manualInvoice,
  pay,
  previewClosing,
  refund,
  type FinanceClinic,
} from "./billing-fixtures.ts";

// Finance F2 slice 5: the refund and cash closing specs' shared steps — an edit and a void with their
// `If-Match`, a paid invoice, a cash refund, the closing preview and close, and a day of the clock.

const DAY = 86_400_000;
export const REASON = "returned a service";

/** One free line of the given price: the invoice's total when it is the only line. */
const freeLine = (unitPriceMinor: string) => ({
  kind: "free",
  descriptionAr: "جلسة",
  descriptionEn: "Session",
  quantity: 1,
  unitPriceMinor,
  discount: null,
});

/** PATCH /v1/invoices/:id with `If-Match`: the new total comes from its only line. */
export const editTo = (
  h: Harness,
  cookie: string,
  invoiceId: string,
  totalMinor: string,
  ifMatch: string,
) =>
  call(h, {
    method: "PATCH",
    url: `/v1/invoices/${invoiceId}`,
    host: APP,
    cookie,
    body: { lines: [freeLine(totalMinor)], invoiceDiscount: null },
    headers: { "if-match": ifMatch },
  });

/** POST /v1/invoices/:id/void with the invoice's current ETag. */
export async function voidInvoice(h: Harness, cookie: string, invoiceId: string) {
  const shown = await call(h, {
    method: "GET",
    url: `/v1/invoices/${invoiceId}`,
    host: APP,
    cookie,
  });
  return call(h, {
    method: "POST",
    url: `/v1/invoices/${invoiceId}/void`,
    host: APP,
    cookie,
    body: { reason: "issued twice" },
    headers: { "if-match": String(shown.headers["etag"]) },
  });
}

/**
 * Runs `step` with the clock `days` ahead of now, so the clinic's business day moves too; a branch
 * closes once a clinic day (F2-Q9).
 *
 * @returns what the step returned
 */
export async function onDay<T>(clock: Clock, days: number, step: () => Promise<T>): Promise<T> {
  const real = clock.now;
  const start = Date.now();
  const at = real().getTime() + days * DAY;
  clock.now = () => new Date(at + (Date.now() - start));
  try {
    return await step();
  } finally {
    clock.now = real;
  }
}

export type Movement = { kind: string; cashSeq: string; amountMinor: string };
export type Preview = {
  businessDate: string;
  previousClosingId: string | null;
  fromCashSeq: string;
  throughCashSeq: string;
  cashInMinor: string;
  cashOutMinor: string;
  expectedMinor: string;
  methodTotals: { method: string; inMinor: string; outMinor: string }[];
  movements: Movement[];
};
export type Closing = {
  id: string;
  businessDate: string;
  previousClosingId: string | null;
  fromCashSeq: string;
  toCashSeq: string;
  expectedMinor: string;
  countedMinor: string;
  differenceMinor: string;
  note: string | null;
  movements: Movement[];
};

/** The closing steps of one clinic, as its admin, on branch R unless told otherwise. */
export function closingSteps(h: Harness, C: FinanceClinic) {
  const preview = async (branchId = C.branchR) => {
    const res = await previewClosing(h, C.admin.cookie, branchId);
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as Preview;
  };
  const closeWith = (
    shown: Preview,
    countedMinor: string,
    note?: string,
    branchId = C.branchR,
    key = randomUUID(),
  ) =>
    closeCash(
      h,
      C.admin.cookie,
      {
        branchId,
        previousClosingId: shown.previousClosingId,
        throughCashSeq: shown.throughCashSeq,
        countedMinor,
        ...(note === undefined ? {} : { note }),
      },
      key,
    );
  const paid = async (patientId: string, total: string, method: string, branchId = C.branchR) => {
    const invoice = await manualInvoice(h, C.admin.cookie, patientId, branchId, total);
    const res = await pay(h, C.admin.cookie, invoice.id, { method, amountMinor: total });
    expect(res.statusCode, res.body).toBe(201);
    return { invoice, paymentId: (res.json() as { payment: { id: string } }).payment.id };
  };
  const cashRefund = async (invoiceId: string, paymentId: string, amountMinor: string) => {
    const res = await refund(h, C.admin.cookie, invoiceId, {
      source: "payment",
      paymentId,
      amountMinor,
      method: "cash",
      reason: REASON,
    });
    expect(res.statusCode, res.body).toBe(201);
  };
  return { preview, closeWith, paid, cashRefund };
}

/** The closing a POST or a GET answered. */
export const closingOf = (res: { json: () => unknown }) =>
  (res.json() as { cashClosing: Closing }).cashClosing;
