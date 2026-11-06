import { describe, expect, it } from "vitest";
import { pdfLinkExpired, pdfSubscriptionBlocked } from "../domain/pdf-delivery.ts";

const now = new Date("2026-01-01T00:00:00.000Z");

describe("PDF delivery expiry", () => {
  it.each([
    ["2025-12-31T23:59:59.999Z", true],
    ["2026-01-01T00:00:00.000Z", true],
    ["2026-01-01T00:00:00.001Z", false],
  ] as const)("refuses a link at or past its deadline: %s", (expiresAt, expired) => {
    expect(pdfLinkExpired(expiresAt, now)).toBe(expired);
  });

  it.each([
    ["active", "2025-12-31T23:59:59.999Z", true],
    ["active", "2026-01-01T00:00:00.000Z", true],
    ["active", "2026-01-01T00:00:00.001Z", false],
    ["suspended", "2026-01-01T00:00:00.001Z", true],
  ] as const)("checks subscription state and deadline: %s / %s", (status, expiresAt, blocked) => {
    expect(pdfSubscriptionBlocked(status, expiresAt, now)).toBe(blocked);
  });
});
