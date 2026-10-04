import { Writable } from "node:stream";
import { performance } from "node:perf_hooks";

import type { Logger } from "pino";
import { describe, expect, it } from "vitest";

import { createLogger } from "../logger.ts";
import { REDACTED, sanitize } from "../redaction.ts";

// A log field has no business being huge, so anything over 64 KB short-circuits and every scanner quantifier
// is bounded. These timings guard against a future edit re-introducing a quadratic scan; they run against
// the same public `sanitize` a caller uses.

const LARGE = 100_000;
// Just under the 64 KB cap: a larger value would be replaced whole and would not exercise a scanner.
const NEAR_CAP = 64_000;

const elapsed = (value: string): number => {
  const start = performance.now();
  sanitize({ note: value });
  return performance.now() - start;
};

describe("sanitize stays linear on adversarial strings", () => {
  // Just UNDER the 64 KB cap: an over-cap value is replaced without being scanned, so a 100 KB input passed
  // these budgets without ever reaching the scanners (and hid a ~1 s quadratic "a=a=a=…" re-read).
  it.each([
    ["a", "a".repeat(NEAR_CAP)],
    ["a.", "a.".repeat(NEAR_CAP / 2)],
    ["a@", "a@".repeat(NEAR_CAP / 2)],
    ["a=", "a=".repeat(NEAR_CAP / 2)],
    ["a:", "a:".repeat(NEAR_CAP / 2)],
    ["=a", "=a".repeat(NEAR_CAP / 2)],
    [":a", ":a".repeat(NEAR_CAP / 2)],
    ["a=b ", "a=b ".repeat(NEAR_CAP / 4)],
    ["password=", "password=".repeat(NEAR_CAP / 9)],
    ["%41", "%41".repeat(NEAR_CAP / 3)],
    ["/", "/".repeat(NEAR_CAP)],
    ["//", "x,//".repeat(NEAR_CAP / 4)],
  ])("64 KB of %s is scanned and completes in < 150 ms", (_label, value) => {
    expect(value.length).toBeGreaterThan(60_000);
    expect(value.length).toBeLessThan(64 * 1024);
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

// An unbounded email local part retries every split point, so N word characters followed by a lone "@" cost
// seconds. RFC 5321 caps the local part and each label, so the shapes below must stay under budget.
describe("the email scanner stays linear", () => {
  it.each([
    ["word chars then @", "a".repeat(NEAR_CAP) + "@"],
    ["dotted run then @", "a.".repeat(NEAR_CAP / 2) + "@"],
    ["password run then @", "password".repeat(NEAR_CAP / 8) + "@"],
    ["Arabic run then @", "ب".repeat(NEAR_CAP) + "@"],
    // Every position of these is a legal local-part start, which a single regex re-read 64+ chars from.
    ["Arabic dotted run then @", "ب.".repeat(NEAR_CAP / 2) + "@"],
    ["spaced letters then an address", " a".repeat(NEAR_CAP / 2) + "@x.co"],
    ["punctuated letters then an address", "!a".repeat(NEAR_CAP / 2) + "@x.co"],
    ["many short addresses", "a@".repeat(NEAR_CAP / 2)],
  ])("64 KB of %s completes in < 150 ms", (_label, value) => {
    expect(value.length).toBeGreaterThan(60_000);
    expect(value.length).toBeLessThan(64 * 1024);
    expect(elapsed(value)).toBeLessThan(150);
  });

  it("a 64 KB log line with a long address-like run completes in < 300 ms in total", () => {
    let written = "";
    const sink = new Writable({
      write(chunk, _encoding, done) {
        written += String(chunk);
        done();
      },
    });
    const logger: Logger = createLogger("info", { destination: sink, events: ["probe"] });
    const note = "contact bob@" + "a".repeat(64_000);
    const start = performance.now();
    logger.info({ note }, "probe");
    const took = performance.now() - start;
    expect(took).toBeLessThan(300);
    expect(written).toContain('"msg":"probe"');
  });
});

// The URL scheme class was unbounded too: a long dotted run then "/" made URL_IN_TEXT consume to the end at
// every start position and backtrack. A scheme is at most 15 characters, so the same shapes are linear now.
describe("the URL scanner stays linear", () => {
  it.each([
    ["dotted run then slash", "a.".repeat(32_000) + "/"],
    ["word run then scheme", "a".repeat(LARGE / 2) + "://"],
    // Pins the {0,15} scheme bound: unbounded, each start of the dotted run scanned to its end (1.8 s).
    ["dotted run then a separate URL", "a.".repeat(32_000) + " https://x.io/"],
  ])("100 KB of %s completes in < 150 ms", (_label, value) => {
    expect(elapsed(value)).toBeLessThan(150);
  });
});
