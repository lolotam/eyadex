import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import { REDACTED, sanitize } from "../redaction.ts";

// A log field has no business being huge, so anything over 64 KB short-circuits and every scanner quantifier
// is bounded. These timings guard against a future edit re-introducing a quadratic scan; they run against
// the same public `sanitize` a caller uses.

const LARGE = 100_000;

const elapsed = (value: string): number => {
  const start = performance.now();
  sanitize({ note: value });
  return performance.now() - start;
};

describe("sanitize stays linear on adversarial strings", () => {
  it.each([
    ["a", "a".repeat(LARGE)],
    ["a.", "a.".repeat(LARGE / 2)],
    ["a@", "a@".repeat(LARGE / 2)],
    ["a=", "a=".repeat(LARGE / 2)],
    ["/", "/".repeat(LARGE)],
  ])("100 KB of %s completes in < 150 ms", (_label, value) => {
    expect(value.length).toBeGreaterThanOrEqual(LARGE);
    expect(elapsed(value)).toBeLessThan(150);
  });

  it("replaces an over-cap string whole instead of scanning it", () => {
    expect(sanitize({ note: "a".repeat(LARGE) })).toEqual({ note: REDACTED });
  });

  it("a 16 KB realistic mixed string completes in < 50 ms", () => {
    const block =
      "GET /v1/patients/482193 completed in 12 ms; " +
      "user owner@example.invalid called 5001 2345; " +
      "note: token=abc123def456 and/or km/h 03/10/2026; " +
      "path /invite/tok_live_abcdef1234?code=abc123secret; ";
    const mixed = block.repeat(Math.ceil(16_000 / block.length)).slice(0, 16_000);
    sanitize({ note: mixed }); // warm the regex engine before timing
    const start = performance.now();
    sanitize({ note: mixed });
    expect(performance.now() - start).toBeLessThan(50);
  });
});
