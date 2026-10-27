import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { maxUsersSchema } from "../clinics.ts";
import { invoiceDiscountInputSchema, invoiceLineInputSchema } from "../finance.ts";
import { invoiceListQuerySchema } from "../finance-list.ts";
import {
  MAX_LINE_MINOR,
  MAX_MINOR,
  MIN_MINOR,
  minorAmountSchema,
  minorLineAmountSchema,
  signedMinorAmountSchema,
} from "../money.ts";
import { personaSchema } from "../session.ts";

type Parsed = { success: true; data: unknown } | { success: false; error: z.ZodError };

function issues(result: Parsed): z.ZodIssue[] {
  expect(result.success).toBe(false);
  if (result.success) return [];
  return result.error.issues;
}

// v4 ZodType<Output, Input = unknown> would widen this. The one-argument helper must keep Input string.
type AmountBranch = Extract<z.input<typeof invoiceDiscountInputSchema>, { kind: "amount" }>;
type MinorStaysString = AmountBranch["minor"] extends string
  ? string extends AmountBranch["minor"]
    ? true
    : false
  : false;
function assertType<_T extends true>(): void {}
assertType<MinorStaysString>();

describe("minor-unit strings", () => {
  it("returns the canonical string and never a number", () => {
    expect(minorAmountSchema.parse("12500")).toBe("12500");
    expect(minorAmountSchema.parse("0")).toBe("0");
    expect(minorAmountSchema.parse(MAX_MINOR.toString())).toBe(MAX_MINOR.toString());
    expect(minorLineAmountSchema.parse(MAX_LINE_MINOR.toString())).toBe(MAX_LINE_MINOR.toString());
    expect(signedMinorAmountSchema.parse("-1")).toBe("-1");
    expect(signedMinorAmountSchema.parse(MIN_MINOR.toString())).toBe(MIN_MINOR.toString());
  });

  it("uses validation.amount for a number, a fraction, a leading zero, and a past-ceiling value", () => {
    for (const value of [12500, "1.5", "012", "9223372036854775808", ""]) {
      expect(issues(minorAmountSchema.safeParse(value)).map((issue) => issue.message)).toEqual([
        "validation.amount",
      ]);
    }
    expect(issues(minorAmountSchema.safeParse(12500)).map((issue) => issue.code)).toEqual([
      "invalid_type",
    ]);
    expect(issues(minorAmountSchema.safeParse("1.5")).map((issue) => issue.code)).toEqual([
      "custom",
    ]);
  });

  it("does not apply invalid_type_error to a missing amount", () => {
    expect(
      issues(minorAmountSchema.safeParse(undefined)).map((issue) => ({
        code: issue.code,
        message: issue.message,
      })),
    ).toEqual([{ code: "invalid_type", message: "Required" }]);
  });
});

describe("discount amount input", () => {
  it("accepts a string minor and rejects a number with validation.amount", () => {
    expect(
      invoiceDiscountInputSchema.parse({
        kind: "amount",
        minor: "12500",
        reason: "Synthetic reason",
      }),
    ).toEqual({ kind: "amount", minor: "12500", reason: "Synthetic reason" });
    expect(
      issues(
        invoiceDiscountInputSchema.safeParse({
          kind: "amount",
          minor: 12500,
          reason: "Synthetic reason",
        }),
      ).map((issue) => ({ path: issue.path, code: issue.code, message: issue.message })),
    ).toEqual([{ path: ["minor"], code: "invalid_type", message: "validation.amount" }]);
  });

  it("rejects a number on a line discount the same way", () => {
    expect(
      issues(
        invoiceLineInputSchema.safeParse({
          kind: "free",
          descriptionAr: "Synthetic",
          descriptionEn: "Synthetic",
          quantity: 1,
          unitPriceMinor: "1",
          discount: { kind: "amount", minor: 1, reason: "Synthetic reason" },
        }),
      )
        .filter((issue) => issue.path.join(".") === "discount.minor")
        .map((issue) => issue.message),
    ).toEqual(["validation.amount"]);
  });
});

describe("clinic number messages and production defaults", () => {
  it("names a string maxUsers validation.number, a too-small value validation.min, and a missing value Required", () => {
    expect(issues(maxUsersSchema.safeParse("2")).map((issue) => issue.message)).toEqual([
      "validation.number",
    ]);
    expect(
      issues(maxUsersSchema.safeParse(0)).map((issue) => ({
        code: issue.code,
        message: issue.message,
      })),
    ).toEqual([{ code: "too_small", message: "validation.min" }]);
    expect(issues(maxUsersSchema.safeParse(undefined)).map((issue) => issue.message)).toEqual([
      "Required",
    ]);
  });

  it("fills a missing persona member id with null, including an explicit undefined", () => {
    expect(personaSchema.parse({ kind: "platform_admin", clinicId: null }).memberId).toBeNull();
    expect(
      personaSchema.parse({ kind: "platform_admin", clinicId: null, memberId: undefined }).memberId,
    ).toBeNull();
  });

  it("defaults an empty invoice-list object, coerces a digit string, and rejects a missing object", () => {
    expect(invoiceListQuerySchema.parse({})).toEqual({ limit: 50, encounter: false });
    expect(invoiceListQuerySchema.parse({ limit: "20" })).toEqual({ limit: 20, encounter: false });
    expect(invoiceListQuerySchema.safeParse(undefined).success).toBe(false);
  });
});
