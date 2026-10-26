import { describe, expect, it } from "vitest";
import { NO_FEATURES } from "@eyadex/contracts/clinics";
import { createClinicFormSchema, newClinicFinanceSchema } from "./new-clinic-finance";

// One explicit table for the whole form and for its production tax-rate field. `accepted` cases
// must parse to the same number; the others must fail with exactly this message on the tax rate.
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

// Raw JSON overflow parses to ±Infinity, as a request body would.
const PLUS_OVERFLOW = (JSON.parse('{"taxRateBp":1e999}') as { taxRateBp: number }).taxRateBp;
const MINUS_OVERFLOW = (JSON.parse('{"taxRateBp":-1e999}') as { taxRateBp: number }).taxRateBp;

type Issue = { code: string; path: PropertyKey[]; message?: string };
const issuesOf = (error: { issues: Issue[] } | undefined, withMessage = true) =>
  error?.issues.map((i) =>
    withMessage
      ? { code: i.code, path: i.path, message: i.message }
      : { code: i.code, path: i.path },
  );

describe("[installed zod 4.6.6] createClinicFormSchema taxRateBp", () => {
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

describe("[installed zod 4.6.6] the production taxRateBp field on its own", () => {
  const schema = createClinicFormSchema.shape.taxRateBp;

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

const INT = { code: "invalid_type", path: ["taxRateBp"], message: "validation.number" };
const LOW = { code: "too_small", path: ["taxRateBp"], message: "validation.outOfRange" };
const HIGH = { code: "too_big", path: ["taxRateBp"], message: "validation.outOfRange" };

const FORM_EDGES: [label: string, value: number, issues: Issue[]][] = [
  ["-0.5", -0.5, [INT, LOW]],
  ["10000.5", 10000.5, [INT, HIGH]],
  ["2^53", 9007199254740992, [HIGH]],
  ["1e20", 1e20, [HIGH]],
  ["JSON 1e999", PLUS_OVERFLOW, [INT, HIGH]],
  ["JSON -1e999", MINUS_OVERFLOW, [INT, LOW]],
];

describe("[installed zod 4.6.6] form tax rate keeps the Zod 3 integer and range order", () => {
  it.each(FORM_EDGES)("%s", (_label, value, expected) => {
    const parsed = createClinicFormSchema.safeParse({ ...VALID_BASE, taxRateBp: value });
    expect(parsed.success).toBe(false);
    expect(issuesOf(parsed.error)).toEqual(expected);
  });

  it.each([0, 10000])("%s parses to the same data", (value) => {
    const parsed = createClinicFormSchema.safeParse({ ...VALID_BASE, taxRateBp: value });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ ...VALID_BASE, taxRateBp: value });
  });
});

describe("[installed zod 4.6.6] newClinicFinanceSchema taxRateBp (unconfigured)", () => {
  it.each([{}, { taxRateBp: undefined }])("accepts %o unchanged", (input) => {
    const parsed = newClinicFinanceSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(input);
  });

  const int = { code: "invalid_type", path: ["taxRateBp"] };
  const low = { code: "too_small", path: ["taxRateBp"] };
  const high = { code: "too_big", path: ["taxRateBp"] };
  // Range and wrong-type wording follows Zod 4's defaults; only the integer text is Zod 3's.
  it.each([
    ["-0.5", -0.5, [int, low]],
    ["10000.5", 10000.5, [int, high]],
    ["JSON 1e999", PLUS_OVERFLOW, [int, high]],
    ["JSON -1e999", MINUS_OVERFLOW, [int, low]],
  ] as const)("%s", (_label, value, expected) => {
    const parsed = newClinicFinanceSchema.safeParse({ taxRateBp: value });
    expect(parsed.success).toBe(false);
    expect(issuesOf(parsed.error, false)).toEqual(expected);
    expect(parsed.error?.issues[0]?.message).toBe("Expected integer, received float");
  });
});
