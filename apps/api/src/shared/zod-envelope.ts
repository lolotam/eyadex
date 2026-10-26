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
  return withoutAbortedLengthArtifacts(issues).map((issue) => ({
    path: issue.path.map(String),
    code: publicCode(issue, { value: valueAt(input, issue.path) }),
  }));
}

/**
 * Zod 4 keeps running a length check after a wrong-type abort when the value has `length`.
 * Zod 3 stopped at `invalid_type`. Drop only that continuation, using the issue's own origin,
 * expected, and path. `expected: "int"` continues into a real numeric bound, so that pair stays.
 * A real short or long string has no type abort on its path, and a sibling path is left alone.
 * The original issue list is not mutated.
 */
export function withoutAbortedLengthArtifacts(issues: readonly ZodIssue[]): readonly ZodIssue[] {
  if (!issues.some((issue) => issue.code === "invalid_type" && issue.expected !== "int")) {
    return issues;
  }
  return issues.filter((issue) => !isAbortedLengthArtifact(issue, issues));
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

function isAbortedLengthArtifact(issue: ZodIssue, issues: readonly ZodIssue[]): boolean {
  if (issue.code !== "too_small" && issue.code !== "too_big") return false;
  if (isNumericBoundOrigin(issue.origin)) return false;
  const key = pathKey(issue.path);
  return issues.some(
    (other) =>
      other.code === "invalid_type" &&
      other.expected !== "int" &&
      other.expected !== issue.origin &&
      pathKey(other.path) === key,
  );
}

function isNumericBoundOrigin(origin: string | undefined): boolean {
  return origin === "number" || origin === "int" || origin === "bigint" || origin === "date";
}

function pathKey(path: readonly PropertyKey[]): string {
  return path.map((key) => `${typeof key}:${String(key)}`).join("\0");
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
