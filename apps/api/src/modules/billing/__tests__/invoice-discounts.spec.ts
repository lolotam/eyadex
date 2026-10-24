import { describe, expect, it } from "vitest";

import { discountAuthors, type DiscountedLine } from "../domain/invoice-discounts.ts";

// Finance F3 slice 2b (EY-10.2): who set a discount. A discount that stayed as it is keeps the author it
// had; a discount that changed or moved is the editor's. A discount set before the column existed keeps
// no author at all.

const pct = (bp: number, reason = "courtesy") => ({ kind: "pct", bp, reason }) as const;

/** A free line; `over` changes the fields a discount's fingerprint holds. */
const line = (over: Partial<DiscountedLine> = {}): DiscountedLine => ({
  kind: "free",
  serviceId: null,
  providerId: null,
  quantity: 1,
  unitPriceMinor: "1000",
  discount: null,
  ...over,
});

describe("the author of a discount (EY-10.2)", () => {
  it("gives a line without a discount no author", () => {
    const result = discountAuthors({
      before: { lines: [line({ discount: pct(1000) })], invoiceDiscount: null },
      authors: { invoice: null, lines: new Map([[0, "member-a"]]) },
      after: { lines: [line()], invoiceDiscount: null },
      editor: "member-b",
    });
    expect(result.lines).toEqual([null]);
  });

  it("keeps the author of a line discount that did not change", () => {
    const result = discountAuthors({
      before: { lines: [line({ discount: pct(1000) })], invoiceDiscount: null },
      authors: { invoice: null, lines: new Map([[0, "member-a"]]) },
      after: { lines: [line({ discount: pct(1000) })], invoiceDiscount: null },
      editor: "member-b",
    });
    expect(result.lines).toEqual(["member-a"]);
  });

  it("keeps no author for a discount set before the column existed", () => {
    const result = discountAuthors({
      before: { lines: [line({ discount: pct(1000) })], invoiceDiscount: null },
      authors: { invoice: null, lines: new Map([[0, null]]) },
      after: { lines: [line({ discount: pct(1000) })], invoiceDiscount: null },
      editor: "member-b",
    });
    expect(result.lines).toEqual([null]);
  });

  it("gives the editor a discount that moved to another line", () => {
    const result = discountAuthors({
      before: { lines: [line({ discount: pct(1000) }), line()], invoiceDiscount: null },
      authors: { invoice: null, lines: new Map([[0, "member-a"]]) },
      after: { lines: [line(), line({ discount: pct(1000) })], invoiceDiscount: null },
      editor: "member-b",
    });
    expect(result.lines).toEqual([null, "member-b"]);
  });

  it("gives the editor a discount whose quantity changed", () => {
    const result = discountAuthors({
      before: { lines: [line({ discount: pct(1000) })], invoiceDiscount: null },
      authors: { invoice: null, lines: new Map([[0, "member-a"]]) },
      after: { lines: [line({ discount: pct(1000), quantity: 2 })], invoiceDiscount: null },
      editor: "member-b",
    });
    expect(result.lines).toEqual(["member-b"]);
  });

  it("keeps the author of an invoice discount that did not change", () => {
    const result = discountAuthors({
      before: { lines: [line()], invoiceDiscount: pct(500) },
      authors: { invoice: "member-a", lines: new Map() },
      after: { lines: [line()], invoiceDiscount: pct(500) },
      editor: "member-b",
    });
    expect(result.invoice).toBe("member-a");
  });

  it("gives the editor an invoice discount that changed", () => {
    const result = discountAuthors({
      before: { lines: [line()], invoiceDiscount: pct(500) },
      authors: { invoice: "member-a", lines: new Map() },
      after: { lines: [line()], invoiceDiscount: pct(700) },
      editor: "member-b",
    });
    expect(result.invoice).toBe("member-b");
  });

  it("gives no author to an invoice whose discount was removed", () => {
    const result = discountAuthors({
      before: { lines: [line()], invoiceDiscount: pct(500) },
      authors: { invoice: "member-a", lines: new Map() },
      after: { lines: [line()], invoiceDiscount: null },
      editor: "member-b",
    });
    expect(result.invoice).toBeNull();
  });
});
