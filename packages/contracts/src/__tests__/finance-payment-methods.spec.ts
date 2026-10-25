import { describe, expect, it } from "vitest";
import { financeSettingsSchema, PAYMENT_METHODS } from "../finance.ts";

describe("the finance settings carry the complete payment method list", () => {
  const settings = {
    currency: "KWD",
    currencyExponent: 3,
    taxRateBp: 0,
    commercialRegNo: null,
    hasLogo: false,
  };
  const methods = PAYMENT_METHODS.map((method) => ({ method, enabled: true }));

  it("carries every method when the field is present", () => {
    expect(
      financeSettingsSchema.parse({ ...settings, paymentMethods: methods }).paymentMethods,
    ).toEqual(methods);
  });

  it("refuses a partial method list", () => {
    const result = financeSettingsSchema.safeParse({
      ...settings,
      paymentMethods: methods.slice(0, 1),
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe("validation.required");
  });

  it("refuses a repeated method", () => {
    const repeated = [methods[0], ...methods.slice(0, 3)];
    const result = financeSettingsSchema.safeParse({ ...settings, paymentMethods: repeated });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe("validation.duplicate");
  });

  it("refuses an unknown method", () => {
    expect(
      financeSettingsSchema.safeParse({
        ...settings,
        paymentMethods: [{ method: "card", enabled: true }],
      }).success,
    ).toBe(false);
  });
});
