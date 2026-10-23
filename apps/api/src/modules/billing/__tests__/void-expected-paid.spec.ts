import { describe, expect, it } from "vitest";

import { ApiError } from "../../../shared/errors.ts";
import { requireExpectedPaid } from "../domain/void-expected-paid.ts";

// Finance F2 (issue #113): the amount the user confirmed on the screen must still be the invoice's
// paid amount when the void runs, so a payment recorded after that read refuses the void.

// Runs the rule and returns the API error it answered with; it fails when nothing was thrown.
const catchApiError = (run: () => unknown): ApiError => {
  let caught: unknown = null;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ApiError);
  return caught as ApiError;
};

describe("the expected paid amount of a void (issue #113)", () => {
  it("passes when the request carries no confirmed amount", () => {
    expect(() => requireExpectedPaid("4000")).not.toThrow();
    expect(() => requireExpectedPaid("4000", undefined)).not.toThrow();
  });

  it("passes when the invoice is still paid the confirmed amount", () => {
    // The contract carries canonical decimal strings only, so two equal amounts are always written
    // the same way: there is no other spelling of "4000" that means the same amount.
    expect(() => requireExpectedPaid("4000", "4000")).not.toThrow();
    expect(() => requireExpectedPaid("0", "0")).not.toThrow();
  });

  it("refuses when the invoice was paid more since the read", () => {
    const error = catchApiError(() => requireExpectedPaid("4000", "3000"));
    expect(error.code).toBe("invoice_paid_changed");
  });

  it("refuses when the invoice was paid less since the read", () => {
    const error = catchApiError(() => requireExpectedPaid("3000", "4000"));
    expect(error.code).toBe("invoice_paid_changed");
  });
});
