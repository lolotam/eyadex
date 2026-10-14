import { describe, expect, it } from "vitest";

import {
  computeInvoiceTotals,
  TotalsError,
  type Discount,
  type TotalsLineInput,
} from "../invoice-totals.ts";

const line = (
  position: number,
  unitPriceMinor: bigint,
  discount: Discount | null = null,
  quantity = 1,
): TotalsLineInput => ({ position, quantity, unitPriceMinor, discount });

const amount = (minor: bigint): Discount => ({ kind: "amount", minor });
const pct = (bp: number): Discount => ({ kind: "pct", bp });

// docs/specs/finance-design.md §8b.1: the worked examples every implementation must reproduce.
describe("computeInvoiceTotals — spec §8b.1 worked examples", () => {
  it("E1: a 1-fils invoice discount on two equal lines goes to the first line", () => {
    const t = computeInvoiceTotals({
      lines: [line(1, 500n), line(2, 500n)],
      invoiceDiscount: amount(1n),
      taxRateBp: 0,
    });
    expect(t.lines.map((l) => l.lineTotalMinor)).toEqual([499n, 500n]);
    expect(t.totalMinor).toBe(999n);
  });

  it("E2: the remainder skips a line with no capacity left", () => {
    const t = computeInvoiceTotals({
      lines: [line(1, 0n), line(2, 1n), line(3, 1n)],
      invoiceDiscount: amount(1n),
      taxRateBp: 0,
    });
    expect(t.lines.map((l) => l.lineTotalMinor)).toEqual([0n, 0n, 1n]);
    expect(t.totalMinor).toBe(1n);
  });

  it("E3: a 100 % line discount gives a zero total", () => {
    const t = computeInvoiceTotals({
      lines: [line(1, 12500n, pct(10000))],
      invoiceDiscount: null,
      taxRateBp: 0,
    });
    expect(t.discountMinor).toBe(12500n);
    expect(t.totalMinor).toBe(0n);
  });

  it("E4: tax is computed per line after the allocation and added to the total", () => {
    const t = computeInvoiceTotals({
      lines: [line(1, 3n), line(2, 4n)],
      invoiceDiscount: amount(1n),
      taxRateBp: 1500,
    });
    expect(t.lines.map((l) => [l.lineTotalMinor, l.taxMinor])).toEqual([
      [2n, 0n],
      [4n, 1n],
    ]);
    expect(t.taxMinor).toBe(1n);
    expect(t.totalMinor).toBe(7n);
  });

  it("E5: a percentage discount rounds half up", () => {
    const t = computeInvoiceTotals({
      lines: [line(1, 12345n, pct(1000))],
      invoiceDiscount: null,
      taxRateBp: 0,
    });
    expect(t.lines[0]!.lineDiscountMinor).toBe(1235n);
    expect(t.totalMinor).toBe(11110n);
  });

  it("E6: an invoice discount on a zero sum is refused", () => {
    expect(() =>
      computeInvoiceTotals({
        lines: [line(1, 0n), line(2, 0n)],
        invoiceDiscount: amount(1n),
        taxRateBp: 0,
      }),
    ).toThrow(expect.objectContaining({ code: "discount_exceeds_total" }));
  });
});

describe("computeInvoiceTotals — rules", () => {
  it("adds tax to the total, never subtracts it", () => {
    const t = computeInvoiceTotals({
      lines: [line(1, 1000n)],
      invoiceDiscount: null,
      taxRateBp: 500,
    });
    expect(t.taxMinor).toBe(50n);
    expect(t.totalMinor).toBe(1050n);
  });

  it("multiplies by the quantity and reports subtotal and discount", () => {
    const t = computeInvoiceTotals({
      lines: [line(1, 2500n, amount(500n), 3)],
      invoiceDiscount: pct(1000),
      taxRateBp: 0,
    });
    expect(t.subtotalMinor).toBe(7500n);
    // line 7500 − 500 = 7000; invoice 10 % of 7000 = 700
    expect(t.discountMinor).toBe(1200n);
    expect(t.totalMinor).toBe(6300n);
  });

  it("orders lines by position whatever the input order", () => {
    const t = computeInvoiceTotals({
      lines: [line(2, 500n), line(1, 500n)],
      invoiceDiscount: amount(1n),
      taxRateBp: 0,
    });
    expect(t.lines.map((l) => [l.position, l.lineTotalMinor])).toEqual([
      [1, 499n],
      [2, 500n],
    ]);
  });

  it("accepts a 0 % invoice discount on a zero sum", () => {
    const t = computeInvoiceTotals({ lines: [line(1, 0n)], invoiceDiscount: pct(0), taxRateBp: 0 });
    expect(t.totalMinor).toBe(0n);
  });

  it.each<[string, TotalsLineInput[], Discount | null, number]>([
    ["a line amount discount above the line", [line(1, 10n, amount(11n))], null, 0],
    ["an invoice amount discount above the net sum", [line(1, 10n)], amount(11n), 0],
    ["quantity 0", [line(1, 10n, null, 0)], null, 0],
    ["quantity 1000", [line(1, 10n, null, 1000)], null, 0],
    ["a duplicate position", [line(1, 10n), line(1, 10n)], null, 0],
    ["a negative price", [line(1, -1n)], null, 0],
    ["a percentage above 100 %", [line(1, 10n, pct(10001))], null, 0],
    ["a tax rate above 100 %", [line(1, 10n)], null, 10001],
    ["a line above the bound", [line(1, 1_000_000_000_001n)], null, 0],
  ])("refuses %s", (_label, lines, invoiceDiscount, taxRateBp) => {
    expect(() => computeInvoiceTotals({ lines, invoiceDiscount, taxRateBp })).toThrow(TotalsError);
  });
});
