// Synthetic R7/R8 pages: ids, names and numbers resemble nothing real.
import type { DiscountRow, DiscountsPage } from "./use-discounts-pages";
import type { RefundRow, RefundsPage } from "./use-refunds-pages";

export const R7_KEYS = ["view:report_patients:clinic", "view:payments:clinic"];
export const R8_KEYS = ["view:report_patients:clinic", "view:invoices:clinic"];
const id = (prefix: string, n: number) =>
  `00000000-0000-7000-8000-0000000${prefix}${String(n).padStart(2, "0")}`;
export const ADJ_PATIENT_ID = (n: number) => id("a0", n);
export const REFUND_ID = (n: number) => id("a1", n);
export const INVOICE_ID = (n: number) => id("a2", n);
const BRANCH_ID = id("a3", 1);

export function refundRow(n: number, amount: string, over: Partial<RefundRow> = {}): RefundRow {
  return {
    refundId: REFUND_ID(n),
    refundNumber: `RF-${n}`,
    branchId: BRANCH_ID,
    branchName: "Branch Test",
    businessDate: "2026-10-01",
    patientId: ADJ_PATIENT_ID(n),
    patientName: `Adjust Person ${n}`,
    method: "cash",
    source: "payment",
    amountMinor: amount,
    refundedBy: id("a4", n),
    refundedByName: `Staff Test ${n}`,
    reason: `Reason ${n}`,
    currency: "KWD",
    ...over,
  };
}

export function discountRow(n: number, amount: string, over: Partial<DiscountRow> = {}): DiscountRow {
  return {
    invoiceId: INVOICE_ID(n),
    invoiceNumber: `T-${n}`,
    branchId: BRANCH_ID,
    branchName: "Branch Test",
    businessDate: "2026-10-01",
    patientId: ADJ_PATIENT_ID(n),
    patientName: `Adjust Person ${n}`,
    kind: "line",
    discountMinor: amount,
    discountedBy: id("a4", n),
    discountedByName: `Staff Test ${n}`,
    reason: `Reason ${n}`,
    currency: "KWD",
    ...over,
  };
}

export function pageOf<R>(items: R[], total: number, nextCursor: string | null) {
  return { items, nextCursor, total, currency: "KWD" as const, currencyExponent: 3 };
}
export type AnyPage = RefundsPage | DiscountsPage;
