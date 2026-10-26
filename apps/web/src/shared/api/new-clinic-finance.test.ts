import { describe, expect, it } from "vitest";
import * as z4 from "zod/v4";
import { NO_FEATURES } from "@eyadex/contracts/clinics";
import { createClinicFormSchema, taxRateNumberParams } from "./new-clinic-finance";

// One explicit table for the installed default parser and the v4 subpath. `accepted` cases must
// parse to the same number; the others must fail with exactly this message on the tax rate.
type Case =
  | [label: string, value: unknown, outcome: { accepted: number }]
  | [label: string, value: unknown, outcome: { message: string }];

const CASES: Case[] = [
  ["undefined", undefined, { message: "Required" }],
  ["null", null, { message: "validation.number" }],
  ["text", "abc", { message: "validation.number" }],
  ["NaN", Number.NaN, { message: "validation.number" }],
  ["boolean", true, { message: "validation.number" }],
  ["fraction", 1.5, { message: "validation.number" }],
  ["below 0", -1, { message: "validation.outOfRange" }],
  ["above 10000", 10001, { message: "validation.outOfRange" }],
  ["0", 0, { accepted: 0 }],
  ["10000", 10000, { accepted: 10000 }],
];

// A complete synthetic clinic (no real data) that passes every other field on its own.
const VALID_BASE = {
  nameAr: "عيادة الاختبار",
  nameEn: "Test Clinic",
  slug: "test-clinic",
  specialty: "dental",
  defaultLanguage: "en",
  timezone: "Asia/Kuwait",
  adminName: "First Admin",
  adminEmail: "first.admin@example.com",
  maxUsers: 10,
  maxBranches: 3,
  modules: { ...NO_FEATURES },
  currency: "KWD",
};

describe("[installed default parser (baseline 3.25.76)] createClinicFormSchema taxRateBp", () => {
  it("the base alone is valid, so every failure below is the tax rate's", () => {
    expect(createClinicFormSchema.safeParse({ ...VALID_BASE, taxRateBp: 500 }).success).toBe(true);
  });

  it.each(CASES)("%s", (_label, value, outcome) => {
    const parsed = createClinicFormSchema.safeParse({ ...VALID_BASE, taxRateBp: value });
    if ("accepted" in outcome) {
      expect(parsed.success).toBe(true);
      expect(parsed.data?.taxRateBp).toBe(outcome.accepted);
    } else {
      expect(parsed.success).toBe(false);
      const issues = parsed.error?.issues.map((i) => ({ path: i.path, message: i.message }));
      expect(issues).toEqual([{ path: ["taxRateBp"], message: outcome.message }]);
    }
  });
});

describe("[v4 subpath — preflight evidence only, not 4.6.6 proof] taxRateNumberParams", () => {
  const schema = z4
    .number(taxRateNumberParams)
    .int("validation.number")
    .min(0, "validation.outOfRange")
    .max(10000, "validation.outOfRange");

  it.each(CASES)("%s", (_label, value, outcome) => {
    const parsed = schema.safeParse(value);
    if ("accepted" in outcome) {
      expect(parsed.success).toBe(true);
      expect(parsed.data).toBe(outcome.accepted);
    } else {
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((i) => i.message)).toEqual([outcome.message]);
    }
  });
});
