import { describe, expect, it } from "vitest";
import * as z4 from "zod/v4";
import { createClinicFormSchema, taxRateNumberParams } from "./new-clinic-finance";

// One table for the installed default parser and the v4 subpath: the tax rate messages must match.
const CASES: [label: string, value: unknown, message: string | null][] = [
  ["undefined", undefined, "Required"],
  ["null", null, "validation.number"],
  ["text", "abc", "validation.number"],
  ["NaN", Number.NaN, "validation.number"],
  ["boolean", true, "validation.number"],
  ["fraction", 1.5, "validation.number"],
  ["below 0", -1, "validation.outOfRange"],
  ["above 10000", 10001, "validation.outOfRange"],
  ["0", 0, null],
  ["10000", 10000, null],
];

type Parser = {
  safeParse(input: unknown): {
    success: boolean;
    error?: { issues: { path: PropertyKey[]; message: string }[] };
  };
};

const firstMessage = (parser: Parser, input: unknown, path: PropertyKey[]) => {
  const result = parser.safeParse(input);
  if (result.success) return null;
  const issue = result.error?.issues.find((i) => path.every((p, n) => i.path[n] === p));
  return issue?.message ?? "(no issue on the field)";
};

describe("[installed default parser (baseline 3.25.76)] createClinicFormSchema taxRateBp messages", () => {
  it.each(CASES)("%s", (_label, value, message) => {
    // Only the tax rate's own issue is read, so the other fields' validity does not matter.
    const parsed = createClinicFormSchema.safeParse({ taxRateBp: value, currency: "KWD" });
    const issue = parsed.success
      ? undefined
      : parsed.error.issues.find((i) => i.path[0] === "taxRateBp");
    expect(issue?.message ?? null).toBe(message);
  });
});

describe("[v4 subpath — preflight evidence only, not 4.6.6 proof] taxRateNumberParams", () => {
  const schema = z4
    .number(taxRateNumberParams)
    .int("validation.number")
    .min(0, "validation.outOfRange")
    .max(10000, "validation.outOfRange");
  it.each(CASES)("%s", (_label, value, message) => {
    expect(firstMessage(schema, value, [])).toBe(message);
  });
});
