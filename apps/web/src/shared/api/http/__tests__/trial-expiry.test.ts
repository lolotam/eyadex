import { describe, expect, it } from "vitest";
import { endOfLocalDay } from "../subscription-expiry";

describe("the end of a clinic's local day", () => {
  it("follows the zone's offset on that date", () => {
    expect(endOfLocalDay("2026-03-15", "Asia/Dubai")).toBe("2026-03-15T19:59:59Z");
    expect(endOfLocalDay("2026-01-15", "Africa/Cairo")).toBe("2026-01-15T21:59:59Z");
  });
});
