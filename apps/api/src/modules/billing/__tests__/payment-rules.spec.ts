import { SettlementError } from "@eyadex/contracts/settlement";
import { describe, expect, it } from "vitest";

import { ApiError } from "../../../shared/errors.ts";
import {
  clinicBusinessDay,
  formatReceiptNumber,
  formatRefundNumber,
  paymentMethodSettings,
  requireMethodEnabled,
  requireSomeMethodEnabled,
  settle,
  type PaymentMethodRow,
} from "../domain/payment-rules.ts";

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

describe("payment rules — the numbers", () => {
  it("pads the sequence to six digits and keeps a longer number whole", () => {
    expect(formatReceiptNumber("F2T", 2026, 1)).toBe("F2T-R-2026-000001");
    expect(formatReceiptNumber("F2T", 2026, 1234567)).toBe("F2T-R-2026-1234567");
    expect(formatRefundNumber("SLM", 2026, 1)).toBe("SLM-RF-2026-000001");
  });
});

describe("payment rules — the payment methods", () => {
  it("lists the four methods in the fixed order, enabled when there is no row", () => {
    expect(paymentMethodSettings([])).toEqual([
      { method: "cash", enabled: true },
      { method: "knet", enabled: true },
      { method: "bank_transfer", enabled: true },
      { method: "other", enabled: true },
    ]);
  });

  it("lets a row decide its own method and keeps the fixed order", () => {
    const rows: PaymentMethodRow[] = [{ method: "knet", enabled: false }];
    expect(paymentMethodSettings(rows)).toEqual([
      { method: "cash", enabled: true },
      { method: "knet", enabled: false },
      { method: "bank_transfer", enabled: true },
      { method: "other", enabled: true },
    ]);
    const otherOrder: PaymentMethodRow[] = [
      { method: "other", enabled: false },
      { method: "knet", enabled: false },
    ];
    expect(paymentMethodSettings(otherOrder).map((setting) => setting.method)).toEqual([
      "cash",
      "knet",
      "bank_transfer",
      "other",
    ]);
  });

  it("refuses a disabled method and passes a method with no row", () => {
    const rows: PaymentMethodRow[] = [{ method: "knet", enabled: false }];
    const error = catchApiError(() => requireMethodEnabled(rows, "knet"));
    expect(error.code).toBe("payment_method_disabled");
    expect(() => requireMethodEnabled(rows, "cash")).not.toThrow();
  });

  it("needs at least one enabled method", () => {
    const allOff = paymentMethodSettings([
      { method: "cash", enabled: false },
      { method: "knet", enabled: false },
      { method: "bank_transfer", enabled: false },
      { method: "other", enabled: false },
    ]);
    const error = catchApiError(() => requireSomeMethodEnabled(allOff));
    expect(error.code).toBe("payment_methods_empty");
    const oneOn = paymentMethodSettings([{ method: "other", enabled: true }]);
    expect(() => requireSomeMethodEnabled(oneOn)).not.toThrow();
  });
});

describe("payment rules — the business day", () => {
  it("reads the clinic day and year in the clinic zone", () => {
    const at = new Date("2026-12-31T21:30:00.000Z");
    const kuwait = clinicBusinessDay(at, "Asia/Kuwait");
    expect(kuwait).toEqual({ businessDate: "2027-01-01", year: 2027 });
    const utc = clinicBusinessDay(at, "UTC");
    expect(utc).toEqual({ businessDate: "2026-12-31", year: 2026 });
  });
});

describe("payment rules — settle", () => {
  it("answers a settlement refusal with its own code", () => {
    const plan = (): never => {
      throw new SettlementError("payment_exceeds_balance");
    };
    const error = catchApiError(() => settle(plan));
    expect(error.code).toBe("payment_exceeds_balance");
  });

  it("answers an invalid amount with a validation error", () => {
    const plan = (): never => {
      throw new SettlementError("invalid_amount");
    };
    const error = catchApiError(() => settle(plan));
    expect(error.code).toBe("validation");
    expect(error.details).toEqual([{ path: ["amountMinor"], code: "validation.amount" }]);
  });

  it("returns the plan's value and rethrows anything else unchanged", () => {
    expect(settle(() => 42)).toBe(42);
    const failure = new Error("boom");
    let caught: unknown = null;
    try {
      settle(() => {
        throw failure;
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
  });
});
