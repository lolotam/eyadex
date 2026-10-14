import { MAX_LINE_MINOR, MAX_MINOR } from "./money.ts";

/** A discount as stored: a percentage in basis points (10000 = 100 %) or an amount in minor units. */
export type Discount = { kind: "pct"; bp: number } | { kind: "amount"; minor: bigint };

export interface TotalsLineInput {
  readonly position: number;
  readonly quantity: number;
  readonly unitPriceMinor: bigint;
  readonly discount: Discount | null;
}

export interface TotalsInput {
  readonly lines: readonly TotalsLineInput[];
  readonly invoiceDiscount: Discount | null;
  readonly taxRateBp: number;
}

export interface TotalsLine {
  readonly position: number;
  readonly grossMinor: bigint;
  readonly lineDiscountMinor: bigint;
  readonly netMinor: bigint;
  readonly allocatedMinor: bigint;
  readonly lineTotalMinor: bigint;
  readonly taxMinor: bigint;
}

export interface Totals {
  readonly lines: readonly TotalsLine[];
  readonly subtotalMinor: bigint;
  readonly discountMinor: bigint;
  readonly taxMinor: bigint;
  readonly totalMinor: bigint;
}

export type TotalsErrorCode = "discount_exceeds_total" | "amount_out_of_range" | "invalid_line";

/** A rule of the totals function was broken; the API answers it as `validation` with this code. */
export class TotalsError extends Error {
  constructor(readonly code: TotalsErrorCode) {
    super(code);
    this.name = "TotalsError";
  }
}

const BP = 10000n;

/**
 * Integer division rounding half up, for non-negative operands (R1-1).
 *
 * @param numerator a non-negative amount
 * @param denominator a positive divisor
 * @returns the quotient rounded half up
 */
export function roundHalfUpDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (2n * denominator);
}

function checkBp(bp: number): bigint {
  if (!Number.isInteger(bp) || bp < 0 || bp > 10000) throw new TotalsError("invalid_line");
  return BigInt(bp);
}

function discountOn(base: bigint, discount: Discount | null): bigint {
  if (discount === null) return 0n;
  if (discount.kind === "pct") return roundHalfUpDiv(base * checkBp(discount.bp), BP);
  if (discount.minor < 0n || discount.minor > base) throw new TotalsError("discount_exceeds_total");
  return discount.minor;
}

function grossLines(input: readonly TotalsLineInput[]) {
  const seen = new Set<number>();
  return [...input]
    .sort((a, b) => a.position - b.position)
    .map((l) => {
      const validQuantity = Number.isInteger(l.quantity) && l.quantity >= 1 && l.quantity <= 999;
      if (seen.has(l.position) || !validQuantity || l.unitPriceMinor < 0n) {
        throw new TotalsError("invalid_line");
      }
      seen.add(l.position);
      const grossMinor = l.unitPriceMinor * BigInt(l.quantity);
      if (grossMinor > MAX_LINE_MINOR) throw new TotalsError("amount_out_of_range");
      const lineDiscountMinor = discountOn(grossMinor, l.discount);
      return {
        position: l.position,
        grossMinor,
        lineDiscountMinor,
        netMinor: grossMinor - lineDiscountMinor,
      };
    });
}

// R2-1: proportional shares rounded down, then the remainder one unit at a time to the lines that still
// have room, in position order — so a line never goes below zero and the result never depends on the input order.
function allocate(nets: readonly bigint[], discount: bigint): bigint[] {
  const sum = nets.reduce((s, n) => s + n, 0n);
  const shares = nets.map((n) => (sum === 0n ? 0n : (discount * n) / sum));
  let rest = discount - shares.reduce((s, n) => s + n, 0n);
  while (rest > 0n) {
    for (let i = 0; i < nets.length && rest > 0n; i++) {
      if (nets[i]! - shares[i]! > 0n) {
        shares[i] = shares[i]! + 1n;
        rest -= 1n;
      }
    }
  }
  return shares;
}

/**
 * The one totals function (finance spec R1-1 and R2-1), shared by the API, the mock and the print view, so a
 * printed total never differs from the stored one: line discounts, then the invoice discount allocated to the
 * lines, then tax per line, and `total = Σ line_total + tax`.
 *
 * @param input the lines in any order, the invoice discount and the clinic tax rate in basis points
 * @returns every line's amounts and the invoice totals, all in minor units
 */
export function computeInvoiceTotals(input: TotalsInput): Totals {
  const tax = checkBp(input.taxRateBp);
  const lines = grossLines(input.lines);
  const nets = lines.map((l) => l.netMinor);
  const netSum = nets.reduce((s, n) => s + n, 0n);
  const free =
    input.invoiceDiscount === null ||
    (input.invoiceDiscount.kind === "pct" && input.invoiceDiscount.bp === 0);
  if (!free && netSum === 0n) throw new TotalsError("discount_exceeds_total");
  const invoiceDiscount = free ? 0n : discountOn(netSum, input.invoiceDiscount);
  const shares = allocate(nets, invoiceDiscount);
  const out = lines.map((l, i) => {
    const lineTotalMinor = l.netMinor - shares[i]!;
    return {
      ...l,
      allocatedMinor: shares[i]!,
      lineTotalMinor,
      taxMinor: roundHalfUpDiv(lineTotalMinor * tax, BP),
    };
  });
  const taxMinor = out.reduce((s, l) => s + l.taxMinor, 0n);
  return {
    lines: out,
    subtotalMinor: bounded(out.reduce((s, l) => s + l.grossMinor, 0n)),
    discountMinor: bounded(out.reduce((s, l) => s + l.lineDiscountMinor, 0n) + invoiceDiscount),
    taxMinor: bounded(taxMinor),
    totalMinor: bounded(out.reduce((s, l) => s + l.lineTotalMinor, 0n) + taxMinor),
  };
}

// Every aggregate must fit the PostgreSQL bigint column it lands in (R1-2); lines are capped separately.
function bounded(value: bigint): bigint {
  if (value > MAX_MINOR) throw new TotalsError("amount_out_of_range");
  return value;
}
