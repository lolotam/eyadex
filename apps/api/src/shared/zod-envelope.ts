import type { ZodIssue } from "zod";

/**
 * Public HTTP details stay `{ path, code }` and the Zod 3 code names. Zod 4 renames some codes on
 * the raw issue; this map is the only place that rename is hidden. It does not copy the rejected
 * value, pattern, or message — those can be a token or a civil ID.
 *
 * A multi-option `invalid_value` is an enum. Zod 3 reported a non-string there as `invalid_type`
 * and a string as `invalid_enum_value`. The received value has to be supplied by the parse that
 * still holds it (`envelopeIssues`): a finalized issue omits input, and values-length alone cannot
 * tell a bad string from a number. A one-option `invalid_value` stays `invalid_literal` even when
 * the primitive is wrong. Without that received value the previous multi-option map stands, so a
 * raw issue is not guessed into `invalid_type`.
 */
export function envelopeIssue(issue: ZodIssue): { path: string[]; code: string } {
  return { path: issue.path.map(String), code: publicCode(issue) };
}

/** Same map, using the value at each issue path. The value is not copied into the result. */
export function envelopeIssues(
  issues: readonly ZodIssue[],
  input: unknown,
): { path: string[]; code: string }[] {
  return issues.map((issue) => ({
    path: issue.path.map(String),
    code: publicCode(issue, { value: valueAt(input, issue.path) }),
  }));
}

function publicCode(
  issue: {
    code: string;
    discriminator?: unknown;
    values?: readonly unknown[];
  },
  received?: { value: unknown },
): string {
  if (issue.code === "invalid_format") return "invalid_string";
  if (issue.code === "invalid_union" && issue.discriminator !== undefined) {
    return "invalid_union_discriminator";
  }
  if (issue.code === "invalid_value") {
    if (issue.values?.length === 1) return "invalid_literal";
    if (received !== undefined && (issue.values?.length ?? 0) > 1) {
      return typeof received.value === "string" ? "invalid_enum_value" : "invalid_type";
    }
    return "invalid_enum_value";
  }
  return issue.code;
}

function valueAt(input: unknown, path: readonly PropertyKey[]): unknown {
  let current = input;
  for (const key of path) {
    if (typeof current !== "object" || current === null || !Object.hasOwn(current, key)) {
      return undefined;
    }
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    current = descriptor === undefined ? undefined : descriptor.value;
  }
  return current;
}
