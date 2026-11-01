import { z } from "zod";

// Zod 4 `z.number()` rejects Infinity before any later check. A raw JSON `1e999` is that value.
// Zod 3 accepts every non-NaN number, including both infinities, and lets `.int()` and the bounds run.
type NumberError = (issue: { input?: unknown }) => string | undefined;

type NumberIssue = {
  code: "invalid_type";
  expected: "number";
  input: unknown;
  continue: false;
  message?: string;
};

/** A Zod 3 number: finite values and infinities pass; NaN and other types stop here. */
export function legacyNumber(error?: NumberError) {
  return z.custom<number>(undefined).check((payload) => {
    if (typeof payload.value === "number" && !Number.isNaN(payload.value)) return;
    const configured = error?.({ input: payload.value });
    const message =
      configured !== undefined ? configured : payload.value === undefined ? "Required" : undefined;
    const issue: NumberIssue = {
      code: "invalid_type",
      expected: "number",
      input: payload.value,
      continue: false,
    };
    if (message !== undefined) issue.message = message;
    payload.issues.push(issue);
  });
}

/** Zod 3 `z.coerce.number()`: `Number(value)`, then the same number primitive. A Symbol or a throwing `valueOf` still throws, as Zod 3 did; that throw is not caught. */
export function legacyCoercedNumber(error?: NumberError) {
  return z.preprocess((value: unknown) => Number(value), legacyNumber(error));
}
