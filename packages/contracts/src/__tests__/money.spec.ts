import { describe, expect, it } from "vitest";

import {
  formatMinor,
  formatSignedMinor,
  MAX_LINE_MINOR,
  MAX_MINOR,
  MIN_MINOR,
  minorAmountSchema,
  minorLineAmountSchema,
  parseMajorToMinor,
  positiveMinorAmountSchema,
  readMinor,
  signedMinorAmountSchema,
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

describe("signed and positive money (R3-5, R3-7)", () => {
  it.each(["-1", "0", MIN_MINOR.toString(), MAX_MINOR.toString()])("accepts signed %s", (minor) => {
    expect(signedMinorAmountSchema.parse(minor)).toBe(minor);
  });

  it.each([
    "-0",
    "+1",
    "01",
    "-01",
    " 1",
    "1.5",
    "-9223372036854775809",
    "9223372036854775808",
    "10000000000000000000",
    1,
  ])("refuses noncanonical or out-of-range signed %s", (minor) => {
    expect(signedMinorAmountSchema.safeParse(minor).success).toBe(false);
  });

  it.each([
    ["-1", 3, "-0.001"],
    ["-12500", 3, "-12.500"],
    ["0", 3, "0.000"],
    ["1500", 2, "15.00"],
    ["-1", 0, "-1"],
  ])("formats signed %s with exponent %i as %s", (minor, exponent, text) => {
    expect(formatSignedMinor(minor, exponent)).toBe(text);
  });

  it("formats a counted shortage without losing its sign", () => {
    const difference = 10000n - 12500n;
    expect(formatSignedMinor(difference.toString(), 3)).toBe("-2.500");
  });

  it("formats a negative drawer expectation", () => {
    const expected = 1000n - 1500n;
    expect(formatSignedMinor(expected.toString(), 3)).toBe("-0.500");
  });

  it.each(["0", "-1", 1])("refuses non-positive or numeric payment amount %s", (minor) => {
    expect(positiveMinorAmountSchema.safeParse(minor).success).toBe(false);
  });

  it("does not impose the per-line cap on payments", () => {
    expect(positiveMinorAmountSchema.parse("1000000000001")).toBe("1000000000001");
    expect(positiveMinorAmountSchema.parse(MAX_MINOR.toString())).toBe(MAX_MINOR.toString());
  });

  it("retains the aggregate ceiling on positive amounts", () => {
    expect(positiveMinorAmountSchema.safeParse("9223372036854775808").success).toBe(false);
  });
});

describe("readMinor", () => {
  it.each<[string, bigint | null]>([
    ["12500", 12500n],
    ["-1", -1n],
    ["007", null],
    ["1.5", null],
    ["", null],
    ["abc", null],
  ])("reads %s as %s", (amount, expected) => {
    expect(readMinor(amount)).toBe(expected);
  });
});
