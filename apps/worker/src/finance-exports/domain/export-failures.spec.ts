import { describe, expect, it } from "vitest";

import {
  EXPORT_ATTEMPT_LIMIT,
  EXPORT_BACKOFF_MINUTES,
  EXPORT_LEASE_SECONDS,
  MEMBER_BUSY_DEFER_SECONDS,
  ONE_RUNNING_INDEX,
  abandonBackoffMinutes,
  canStartAttempt,
  failureOutcome,
  heartbeatMayRenew,
  isExportFailureKind,
  isFinalFailure,
  isOneRunningCollision,
  rereadVerdict,
} from "./export-failures.ts";

const RETRYABLE = ["build_failed", "store_unavailable", "db_error", "lease_lost"] as const;
const FINAL = ["forbidden", "export_amount_too_large", "attempts_exhausted"] as const;

describe("export failure and backoff", () => {
  it("uses 1, 5, 30 and 120 minutes and never the invitation 360-minute slot", () => {
    expect(EXPORT_BACKOFF_MINUTES).toEqual([1, 5, 30, 120]);
    expect(EXPORT_BACKOFF_MINUTES).not.toContain(360);
    expect(EXPORT_ATTEMPT_LIMIT).toBe(5);
    expect(EXPORT_LEASE_SECONDS).toBe(60);
    expect(MEMBER_BUSY_DEFER_SECONDS).toBe(30);
    expect(ONE_RUNNING_INDEX).toBe("finance_report_exports_one_running_idx");
  });

  it.each(FINAL)("treats %s as final on the first attempt", (kind) => {
    expect(isFinalFailure(kind)).toBe(true);
    expect(failureOutcome(1, kind)).toEqual({ final: true, errorCode: kind, backoffMinutes: null });
  });

  it.each(RETRYABLE)("retries %s on attempts 1..4 with the exact ladder", (kind) => {
    expect(isFinalFailure(kind)).toBe(false);
    EXPORT_BACKOFF_MINUTES.forEach((minutes, index) => {
      expect(failureOutcome(index + 1, kind)).toEqual({
        final: false,
        errorCode: kind,
        backoffMinutes: minutes,
      });
    });
  });

  it.each(RETRYABLE)(
    "makes the fifth %s final without swapping the code or adding 360 minutes",
    (kind) => {
      expect(failureOutcome(5, kind)).toEqual({
        final: true,
        errorCode: kind,
        backoffMinutes: null,
      });
      expect(abandonBackoffMinutes(5)).toBeNull();
    },
  );

  it("keeps a fifth abandon queued-at-limit with no future backoff", () => {
    expect(abandonBackoffMinutes(1)).toBe(1);
    expect(abandonBackoffMinutes(2)).toBe(5);
    expect(abandonBackoffMinutes(3)).toBe(30);
    expect(abandonBackoffMinutes(4)).toBe(120);
    expect(abandonBackoffMinutes(5)).toBeNull();
    expect(canStartAttempt(0)).toBe(true);
    expect(canStartAttempt(4)).toBe(true);
    expect(canStartAttempt(5)).toBe(false);
    expect(isExportFailureKind("build_failed")).toBe(true);
    expect(isExportFailureKind("export_busy")).toBe(false);
  });

  it("catches only the one-running index collision", () => {
    expect(isOneRunningCollision({ code: "23505", constraint: ONE_RUNNING_INDEX })).toBe(true);
    expect(
      isOneRunningCollision({
        code: "23505",
        constraint: "finance_report_export_blobs_attempt_unique",
      }),
    ).toBe(false);
    expect(isOneRunningCollision({ code: "23514", constraint: ONE_RUNNING_INDEX })).toBe(false);
    expect(isOneRunningCollision(new Error(ONE_RUNNING_INDEX))).toBe(false);
  });
});

describe("heartbeat and lost-answer reread", () => {
  it("renews only a live running lease owned by this attempt", () => {
    expect(
      heartbeatMayRenew({
        status: "running",
        leaseLive: true,
        attemptMatches: true,
        ownerMatches: true,
      }),
    ).toBe(true);
    expect(
      heartbeatMayRenew({
        status: "running",
        leaseLive: false,
        attemptMatches: true,
        ownerMatches: true,
      }),
    ).toBe(false);
    for (const status of ["done", "failed", "expired", "purged", "queued"]) {
      expect(
        heartbeatMayRenew({ status, leaseLive: true, attemptMatches: true, ownerMatches: true }),
      ).toBe(false);
    }
    expect(
      heartbeatMayRenew({
        status: "running",
        leaseLive: true,
        attemptMatches: false,
        ownerMatches: true,
      }),
    ).toBe(false);
    expect(
      heartbeatMayRenew({
        status: "running",
        leaseLive: true,
        attemptMatches: true,
        ownerMatches: false,
      }),
    ).toBe(false);
  });

  it("keeps the file only when this attempt's key is done and its blob is published", () => {
    const ownKey = "clinic/c/finance-exports/e/2.csv";
    expect(
      rereadVerdict({
        status: "done",
        storageKey: ownKey,
        ownKey,
        blobState: "published",
        blobKey: ownKey,
      }),
    ).toBe("own_success");
    expect(
      rereadVerdict({
        status: "done",
        storageKey: ownKey,
        ownKey,
        blobState: "published",
        blobKey: "clinic/c/finance-exports/e/2.xlsx",
      }),
    ).toBe("lost_lease");
    expect(
      rereadVerdict({
        status: "done",
        storageKey: ownKey,
        ownKey,
        blobState: "uploaded",
        blobKey: ownKey,
      }),
    ).toBe("lost_lease");
    expect(
      rereadVerdict({
        status: "done",
        storageKey: "other",
        ownKey,
        blobState: "published",
        blobKey: ownKey,
      }),
    ).toBe("lost_lease");
    expect(
      rereadVerdict({
        status: "running",
        storageKey: ownKey,
        ownKey,
        blobState: "published",
        blobKey: ownKey,
      }),
    ).toBe("lost_lease");
    expect(
      rereadVerdict({ status: "done", storageKey: ownKey, ownKey, blobState: null, blobKey: null }),
    ).toBe("lost_lease");
    expect(
      rereadVerdict({
        status: "failed",
        storageKey: null,
        ownKey,
        blobState: "deleted",
        blobKey: null,
      }),
    ).toBe("lost_lease");
  });
});
