import { describe, expect, it } from "vitest";
import { endOfLocalDay, trialExpiry } from "../subscription-expiry";

describe("a new clinic's trial", () => {
  it("counts days from the clinic's own today and ends at its local midnight", () => {
    // 01:00 on 1 February in Kuwait is still 31 January in UTC.
    const now = new Date("2026-01-31T22:00:00Z");
    expect(trialExpiry(14, "Asia/Kuwait", now)).toBe("2026-02-15T20:59:59Z");
  });
  it("follows the zone's offset on that date", () => {
    expect(endOfLocalDay("2026-03-15", "Asia/Dubai")).toBe("2026-03-15T19:59:59Z");
    expect(endOfLocalDay("2026-01-15", "Africa/Cairo")).toBe("2026-01-15T21:59:59Z");
  });
});
