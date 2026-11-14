import { describe, expect, it } from "vitest";
import { pdfFailureOutcome } from "./pdf-job-failure.ts";

describe("pdfFailureOutcome", () => {
  it.each([
    [1, 0, "store_unavailable", "retry_wait", 1, 30],
    [2, 1, "db_unavailable", "retry_wait", 2, 120],
    [3, 2, "lease_expired", "failed", 2, null],
    [1, 0, "invalid_model", "failed", 0, null],
    [1, 0, "size_limit", "failed", 0, null],
    [1, 0, "cancelled", "cancelled", 0, null],
  ] as const)("attempt %i retry %i code %s", (attempt, retries, code, status, count, delay) => {
    expect(pdfFailureOutcome(code, { attempt, retryCount: retries })).toEqual({
      status,
      retryCount: count,
      delaySeconds: delay,
    });
  });
  it("rejects an unknown public or native error", () => {
    expect(() =>
      pdfFailureOutcome("native_stderr" as never, { attempt: 1, retryCount: 0 }),
    ).toThrow(TypeError);
  });
});
