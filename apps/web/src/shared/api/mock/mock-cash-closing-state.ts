import type { CashClosing, CashMovement, PaymentMethod } from "@eyadex/contracts/finance";
import { PAYMENT_METHODS } from "@eyadex/contracts/finance";
import { MAX_CASH_MINOR, MAX_MINOR } from "@eyadex/contracts/money";
import { financeError } from "../api-error";
import { paymentState } from "./mock-payment-state";
import type { MockState } from "./mock-store";

/** A saved closing: append-only, never edited or reopened (F2-Q11). */
export type StoredClosing = CashClosing & { clinicId: string };

export type ClosingMockState = {
  closings: StoredClosing[];
  /** `clinicId:branchId` → the drawer's last closing and the last cash position it closed. */
  marks: Record<string, { lastClosingId: string; lastClosedSeq: string }>;
  /** Idempotency ledger: the first closing of a key, with the fingerprint of its request. */
  replays: Record<string, { fingerprint: string; closingId: string }>;
};

export function closingState(db: MockState): ClosingMockState {
  db.cashClosings ??= { closings: [], marks: {}, replays: {} };
  return db.cashClosings;
}

/** The period from the drawer (§4.4): after the last closed position, through the last cash position. */
export function closingPeriod(db: MockState, clinicId: string, branchId: string) {
  const key = `${clinicId}:${branchId}`;
  const mark = closingState(db).marks[key];
  return {
    previousClosingId: mark?.lastClosingId ?? null,
    fromCashSeq: BigInt(mark?.lastClosedSeq ?? "0"),
    throughCashSeq: BigInt(paymentState(db).drawers[key] ?? "0"),
  };
}

/** The cash movements of a branch in `(from, through]`, by drawer position; no patient on any of them. */
export function drawerMovements(
  db: MockState,
  clinicId: string,
  branchId: string,
  from: bigint,
  through: bigint,
): CashMovement[] {
  const s = paymentState(db);
  const inside = (r: { clinicId: string; branchId: string; cashSeq: string | null }) =>
    r.clinicId === clinicId &&
    r.branchId === branchId &&
    r.cashSeq !== null &&
    BigInt(r.cashSeq) > from &&
    BigInt(r.cashSeq) <= through;
  const payments: CashMovement[] = s.payments.filter(inside).map((p) => ({
    kind: "payment",
    paymentId: p.id,
    receiptNumber: p.receiptNumber,
    cashSeq: p.cashSeq!,
    amountMinor: p.amountMinor,
    at: p.receivedAt,
  }));
  const refunds: CashMovement[] = s.refunds.filter(inside).map((r) => ({
    kind: "refund",
    refundId: r.id,
    refundNumber: r.refundNumber,
    cashSeq: r.cashSeq!,
    amountMinor: r.amountMinor,
    at: r.refundedAt,
  }));
  return [...payments, ...refunds].sort((a, b) => (BigInt(a.cashSeq) < BigInt(b.cashSeq) ? -1 : 1));
}

/** Cash in minus cash out of the period (F2-Q10: no opening float); refused outside the contract's range. */
export function expectedCash(movements: readonly CashMovement[]) {
  let cashIn = 0n;
  let cashOut = 0n;
  for (const m of movements) {
    if (m.kind === "payment") cashIn += BigInt(m.amountMinor);
    else cashOut += BigInt(m.amountMinor);
  }
  const expected = cashIn - cashOut;
  if (cashIn > MAX_MINOR || cashOut > MAX_MINOR) throw financeError("cash_drawer_out_of_range");
  if (expected > MAX_CASH_MINOR || expected < -MAX_CASH_MINOR) {
    throw financeError("cash_drawer_out_of_range");
  }
  return { cashIn, cashOut, expected };
}

/** Every method's in and out on the branch's business day, in the fixed order, for information only. */
export function methodTotals(
  db: MockState,
  clinicId: string,
  branchId: string,
  businessDate: string,
): { method: PaymentMethod; inMinor: string; outMinor: string }[] {
  const s = paymentState(db);
  const that = (r: { clinicId: string; branchId: string; businessDate: string }) =>
    r.clinicId === clinicId && r.branchId === branchId && r.businessDate === businessDate;
  return PAYMENT_METHODS.map((method) => {
    const sum = (rows: { method: PaymentMethod; amountMinor: string }[]) =>
      String(
        rows.filter((r) => r.method === method).reduce((t, r) => t + BigInt(r.amountMinor), 0n),
      );
    return {
      method,
      inMinor: sum(s.payments.filter(that)),
      outMinor: sum(s.refunds.filter(that)),
    };
  });
}
