// Zod 4 `.int()` is a safe-integer check and stops later min/max after a fraction.
// Zod 3 `.int()` is `Number.isInteger` and keeps going, so both issues stay on the same path.
const LEGACY_INTEGER_MESSAGE = "Expected integer, received float";

type IntegerIssue = {
  code: "invalid_type";
  expected: "int";
  input: number;
  continue: true;
  message: string;
};

/**
 * The Zod 3 integer predicate as a public Zod 4 check. `continue` lets the schema's own min/max
 * still run. Pass the field's existing int message; the default is Zod 3's unconfigured text.
 */
export function legacyInteger(message = LEGACY_INTEGER_MESSAGE) {
  return (payload: { value: number; issues: { push(issue: IntegerIssue): void } }): void => {
    if (Number.isInteger(payload.value)) return;
    payload.issues.push({
      code: "invalid_type",
      expected: "int",
      input: payload.value,
      continue: true,
      message,
    });
  };
}
