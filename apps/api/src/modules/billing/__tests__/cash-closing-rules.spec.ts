import { describe, expect, it } from "vitest";

import { ApiError } from "../../../shared/errors.ts";
import {
  closingPeriod,
  expectedCash,
  requireNoteForDifference,
  requireNotClosedToday,
  requirePreviewCurrent,
  type DrawerMovement,
} from "../domain/cash-closing-rules.ts";

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

const period = { previousClosingId: "K1", fromCashSeq: 3n, throughCashSeq: 7n };

describe("cash closing rules — the period", () => {
  it("starts empty when the branch has no drawer row yet", () => {
    expect(closingPeriod(null)).toEqual({
      previousClosingId: null,
      fromCashSeq: 0n,
      throughCashSeq: 0n,
    });
  });

  it("runs from the last closed number to the last cash number", () => {
    const drawer = { lastCashSeq: 7n, lastClosedSeq: 3n, lastClosingId: "K1" };
    expect(closingPeriod(drawer)).toEqual({
      previousClosingId: "K1",
      fromCashSeq: 3n,
      throughCashSeq: 7n,
    });
  });
});

describe("cash closing rules — the expected cash", () => {
  it("counts the movements of the period only", () => {
    const movements: DrawerMovement[] = [
      { kind: "payment", cashSeq: 3n, amountMinor: 100n },
      { kind: "payment", cashSeq: 4n, amountMinor: 5000n },
      { kind: "refund", cashSeq: 5n, amountMinor: 2000n },
      { kind: "payment", cashSeq: 7n, amountMinor: 1000n },
      { kind: "payment", cashSeq: 8n, amountMinor: 999n },
    ];
    expect(expectedCash(period, movements)).toEqual({
      cashInMinor: 6000n,
      cashOutMinor: 2000n,
      expectedMinor: 4000n,
    });
  });

  it("goes below zero when more was refunded than received", () => {
    const movements: DrawerMovement[] = [
      { kind: "payment", cashSeq: 4n, amountMinor: 1000n },
      { kind: "refund", cashSeq: 5n, amountMinor: 3000n },
    ];
    expect(expectedCash(period, movements)).toEqual({
      cashInMinor: 1000n,
      cashOutMinor: 3000n,
      expectedMinor: -2000n,
    });
  });

  it("expects nothing when the branch had no cash", () => {
    expect(expectedCash(period, [])).toEqual({
      cashInMinor: 0n,
      cashOutMinor: 0n,
      expectedMinor: 0n,
    });
  });
});

describe("cash closing rules — the preview", () => {
  it("passes when the drawer still stands where the preview saw it", () => {
    const sent = { previousClosingId: "K1", throughCashSeq: 7n };
    expect(() => requirePreviewCurrent(period, sent)).not.toThrow();
  });

  it("refuses a drawer that moved since the preview", () => {
    const otherClosing = catchApiError(() =>
      requirePreviewCurrent(period, { previousClosingId: "K0", throughCashSeq: 7n }),
    );
    expect(otherClosing.code).toBe("cash_drawer_changed");
    const otherCash = catchApiError(() =>
      requirePreviewCurrent(period, { previousClosingId: "K1", throughCashSeq: 8n }),
    );
    expect(otherCash.code).toBe("cash_drawer_changed");
    const noClosing = catchApiError(() =>
      requirePreviewCurrent(period, { previousClosingId: null, throughCashSeq: 7n }),
    );
    expect(noClosing.code).toBe("cash_drawer_changed");
  });
});

describe("cash closing rules — one closing a day", () => {
  it("refuses a second closing of the same business day", () => {
    const error = catchApiError(() => requireNotClosedToday("2026-10-20", "2026-10-20"));
    expect(error.code).toBe("cash_closing_exists");
  });

  it("passes another business day and a branch that never closed", () => {
    expect(() => requireNotClosedToday("2026-10-19", "2026-10-20")).not.toThrow();
    expect(() => requireNotClosedToday(null, "2026-10-20")).not.toThrow();
  });
});

describe("cash closing rules — the note", () => {
  it("passes a closing without a difference and without a note", () => {
    expect(() => requireNoteForDifference(1000n, 1000n, null)).not.toThrow();
  });

  it.each([null, "", "   "])("needs a note when the count differs (%s)", (note) => {
    const error = catchApiError(() => requireNoteForDifference(900n, 1000n, note));
    expect(error.code).toBe("closing_note_required");
  });

  it("needs a note for a shortage as well, and passes one when it is written", () => {
    const shortage = catchApiError(() => requireNoteForDifference(1000n, 900n, null));
    expect(shortage.code).toBe("closing_note_required");
    expect(() => requireNoteForDifference(900n, 1000n, "Missing cash")).not.toThrow();
  });
});
