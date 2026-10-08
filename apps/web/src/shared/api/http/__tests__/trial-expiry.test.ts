import { describe, expect, it } from "vitest";
import { endOfLocalDay } from "../subscription-expiry";

describe("the end of a clinic's local day", () => {
  it("follows the zone's offset on that date", () => {
    expect(endOfLocalDay("2026-03-15", "Asia/Dubai")).toBe("2026-03-15T19:59:59Z");
    expect(endOfLocalDay("2026-01-15", "Africa/Cairo")).toBe("2026-01-15T21:59:59Z");
    // Cairo moves to summer time at the start of 24 April 2026: 23 April still ends at UTC+2.
    expect(endOfLocalDay("2026-04-23", "Africa/Cairo")).toBe("2026-04-23T21:59:59Z");
    expect(endOfLocalDay("2026-04-24", "Africa/Cairo")).toBe("2026-04-24T20:59:59Z");
  });
});
