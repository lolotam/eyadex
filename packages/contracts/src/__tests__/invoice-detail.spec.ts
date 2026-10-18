import { describe, expect, it } from "vitest";

import { invoiceListItemSchema, invoiceSchema } from "../finance.ts";

describe("the invoice detail patient label", () => {
  it("accepts an optional display name only on detail while keeping older responses valid", () => {
    const schema = invoiceSchema.pick({ patientName: true });
    expect(schema.parse({ patientName: "Example" })).toEqual({ patientName: "Example" });
    expect(schema.parse({})).toEqual({});
    expect(invoiceListItemSchema.shape).not.toHaveProperty("patientName");
  });
});
