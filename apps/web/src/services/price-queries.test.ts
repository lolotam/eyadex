import { describe, expect, it } from "vitest";
import { minorOfText, priceOf, priceText } from "./price-queries";

const list = { currency: "KWD" as const, currencyExponent: 3, items: [] };

describe("price helpers (F1 §1)", () => {
  it("reads major-unit text into a minor-unit string in the clinic's exponent", () => {
    expect(minorOfText("12.5", 3)).toBe("12500");
    expect(minorOfText("12.5", 2)).toBe("1250");
    expect(minorOfText("1.2345", 3)).toBeNull();
    expect(minorOfText("abc", 3)).toBeNull();
    expect(minorOfText("  ", 3)).toBeNull();
  });

  it("shows minor units with the currency, and an unpriced service has no price", () => {
    expect(priceText(list, "12500")).toBe("12.500 KWD");
    expect(priceOf(list, "s1")).toEqual({ serviceId: "s1", priceMinor: null, providerPrices: [] });
  });
});
