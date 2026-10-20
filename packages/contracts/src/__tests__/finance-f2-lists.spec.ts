import { describe, expect, it } from "vitest";

import {
  cashClosingListQuerySchema,
  cashClosingListResponseSchema,
  paymentListQuerySchema,
  paymentListResponseSchema,
  refundListQuerySchema,
  refundListResponseSchema,
} from "../finance.ts";

const ID = "0198f0a0-0000-7000-8000-000000000001";
const lists = [
  { name: "payments", query: paymentListQuerySchema, response: paymentListResponseSchema },
  { name: "refunds", query: refundListQuerySchema, response: refundListResponseSchema },
  {
    name: "cash closings",
    query: cashClosingListQuerySchema,
    response: cashClosingListResponseSchema,
  },
];

describe.each(lists)("$name list", ({ query, response }) => {
  it("coerces a query-string limit", () => {
    expect(query.parse({ limit: "25" }).limit).toBe(25);
  });

  it("defaults to the F1 page size", () => {
    expect(query.parse({}).limit).toBe(50);
  });

  it.each(["0", "101", "1.5"])("refuses limit %s", (limit) => {
    expect(query.safeParse({ limit }).success).toBe(false);
  });

  it("accepts cursor, branch and real business dates", () => {
    const filters = {
      cursor: "opaque_cursor-1",
      branchId: ID,
      from: "2028-02-29",
      to: "2028-03-01",
    };
    expect(query.parse(filters)).toEqual({ ...filters, limit: 50 });
  });

  it.each(["from", "to"])("rejects an impossible %s date", (field) => {
    expect(query.safeParse({ [field]: "2026-02-29" }).success).toBe(false);
  });

  it("rejects a malformed date", () => {
    expect(query.safeParse({ from: "yesterday" }).success).toBe(false);
  });

  it("rejects unknown filters", () => {
    expect(query.safeParse({ settlement: "paid" }).success).toBe(false);
  });

  it("rejects an invalid cursor", () => {
    expect(query.safeParse({ cursor: "a/b" }).success).toBe(false);
  });

  it("returns a cursor page", () => {
    const page = { items: [], nextCursor: null, total: 0 };
    expect(response.parse(page)).toEqual(page);
  });
});

describe("payment and refund filters", () => {
  it.each([paymentListQuerySchema, refundListQuerySchema])(
    "accepts method, patient and invoice filters",
    (query) => {
      const filters = { method: "knet", patientId: ID, invoiceId: ID };
      expect(query.parse(filters)).toEqual({ ...filters, limit: 50 });
    },
  );

  it("trims receipt numbers", () => {
    expect(
      paymentListQuerySchema.parse({ receiptNumber: " SLM-R-2026-000001 " }).receiptNumber,
    ).toBe("SLM-R-2026-000001");
  });

  it.each([" ", "a".repeat(41)])("rejects an empty or long receipt number", (receiptNumber) => {
    expect(paymentListQuerySchema.safeParse({ receiptNumber }).success).toBe(false);
  });

  it("does not accept a receipt number filter on refunds", () => {
    expect(refundListQuerySchema.safeParse({ receiptNumber: "SLM-R-2026-000001" }).success).toBe(
      false,
    );
  });

  it("does not accept patient filters on cash closings", () => {
    expect(cashClosingListQuerySchema.safeParse({ patientId: ID }).success).toBe(false);
  });
});
