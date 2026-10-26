import type { ZodIssue } from "zod";

/**
 * Public HTTP details stay `{ path, code }` and the Zod 3 code names. Zod 4 renames some codes on
 * the raw issue; this map is the only place that rename is hidden. It does not copy the rejected
 * value, pattern, or message — those can be a token or a civil ID.
 */
export function envelopeIssue(issue: ZodIssue): { path: string[]; code: string } {
  return { path: issue.path.map(String), code: publicCode(issue) };
}

function publicCode(issue: {
  code: string;
  discriminator?: unknown;
  values?: readonly unknown[];
}): string {
  if (issue.code === "invalid_format") return "invalid_string";
  if (issue.code === "invalid_union" && issue.discriminator !== undefined) {
    return "invalid_union_discriminator";
  }
  if (issue.code === "invalid_value") {
    return issue.values?.length === 1 ? "invalid_literal" : "invalid_enum_value";
  }
  return issue.code;
}
