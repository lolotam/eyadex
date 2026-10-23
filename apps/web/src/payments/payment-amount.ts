import { parseMajorToMinor, readMinor } from "@eyadex/contracts/money";

export type AmountCheck =
  | { ok: true; amountMinor: string }
  | { ok: false; error: "amountInvalid" | "payment_exceeds_balance" | "credit_insufficient" };

/**
 * Reads an amount typed in major units and refuses, before sending, what the API would refuse: not an
 * amount (or zero), above what the invoice owes (F2-Q1: no overpayment), above the patient's credit.
 */
export function checkAmount(
  text: string,
  exponent: number,
  limits: { owedMinor: string; creditMinor?: string },
): AmountCheck {
  const minor = parseMajorToMinor(text, exponent);
  const amount = minor === null ? null : readMinor(minor);
  if (minor === null || amount === null || amount <= 0n)
    return { ok: false, error: "amountInvalid" };
  if (amount > (readMinor(limits.owedMinor) ?? 0n)) {
    return { ok: false, error: "payment_exceeds_balance" };
  }
  if (limits.creditMinor !== undefined && amount > (readMinor(limits.creditMinor) ?? 0n)) {
    return { ok: false, error: "credit_insufficient" };
  }
  return { ok: true, amountMinor: minor };
}

/** The smaller of two minor amounts: the credit dialog's prefill. */
export function smallerMinor(a: string, b: string): string {
  return (readMinor(a) ?? 0n) < (readMinor(b) ?? 0n) ? a : b;
}

export type RefundCheck =
  | { ok: true; amountMinor: string }
  | { ok: false; error: "amountInvalid" | "refund_exceeds_available" | "credit_insufficient" };

/**
 * A refund amount typed in major units, refused before sending above its source's cap: a receipt's
 * refundable amount (refund_exceeds_available) or the patient's credit (credit_insufficient).
 */
export function checkRefundAmount(
  text: string,
  exponent: number,
  source: "payment" | "credit",
  capMinor: string,
): RefundCheck {
  const minor = parseMajorToMinor(text, exponent);
  const amount = minor === null ? null : readMinor(minor);
  if (minor === null || amount === null || amount <= 0n) {
    return { ok: false, error: "amountInvalid" };
  }
  if (amount > (readMinor(capMinor) ?? 0n)) {
    return {
      ok: false,
      error: source === "payment" ? "refund_exceeds_available" : "credit_insufficient",
    };
  }
  return { ok: true, amountMinor: minor };
}
