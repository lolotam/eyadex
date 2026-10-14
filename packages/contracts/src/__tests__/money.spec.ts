import { describe, expect, it } from "vitest";

import {
  formatMinor,
  MAX_LINE_MINOR,
  MAX_MINOR,
  minorAmountSchema,
  minorLineAmountSchema,
  parseMajorToMinor,
  SUPPORTED_CURRENCIES,
} from "../money.ts";

describe("money (R1-2)", () => {
  it("knows the minor-unit exponent of each supported currency", () => {
    expect(SUPPORTED_CURRENCIES).toEqual({ KWD: 3, BHD: 3, OMR: 3, SAR: 2, AED: 2, QAR: 2 });
  });

  it.each([
    ["12500", 3, "12.500"],
    ["5", 3, "0.005"],
    ["5", 2, "0.05"],
    ["0", 3, "0.000"],
    ["1000000000000", 3, "1000000000.000"],
  ])("formats %s with exponent %i as %s", (minor, exponent, text) => {
    expect(formatMinor(minor, exponent)).toBe(text);
  });

  it.each([
    ["12.5", 3, "12500"],
    ["12", 3, "12000"],
    ["0.05", 2, "5"],
    ["1.2345", 3, null],
    ["-1", 3, null],
    ["1,5", 3, null],
    ["", 3, null],
  ])("parses %s with exponent %i as %s", (text, exponent, minor) => {
    expect(parseMajorToMinor(text, exponent)).toBe(minor);
  });

  it("accepts minor amounts as canonical decimal integer strings only", () => {
    expect(minorAmountSchema.safeParse("12500").success).toBe(true);
    expect(minorAmountSchema.safeParse("0").success).toBe(true);
    expect(minorAmountSchema.safeParse("1000000000000").success).toBe(true);
    for (const bad of ["012", "-1", "1.5", "1e3", 12500, ""]) {
      expect(minorAmountSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("bounds aggregates by the PostgreSQL bigint ceiling, not the line cap", () => {
    expect(minorAmountSchema.safeParse("3000000000000").success).toBe(true);
    expect(minorAmountSchema.safeParse(MAX_MINOR.toString()).success).toBe(true);
    expect(minorAmountSchema.safeParse("9223372036854775808").success).toBe(false);
    expect(minorAmountSchema.safeParse("10000000000000000000").success).toBe(false);
  });

  it("keeps the per-line cap on line amounts", () => {
    expect(minorLineAmountSchema.safeParse(MAX_LINE_MINOR.toString()).success).toBe(true);
    expect(minorLineAmountSchema.safeParse("1000000000001").success).toBe(false);
    expect(minorLineAmountSchema.safeParse("012").success).toBe(false);
  });
});
