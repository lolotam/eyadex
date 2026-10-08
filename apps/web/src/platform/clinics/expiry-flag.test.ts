import { describe, expect, it } from "vitest";
import { expiryFlagOf } from "./expiry-flag";

const NOW = Date.parse("2026-10-08T00:00:00Z");

describe("expiryFlagOf", () => {
  it("flags a passed expiry as expired, not as expiring soon", () => {
    expect(expiryFlagOf("2026-10-07T23:59:59Z", NOW)).toBe("expired");
    expect(expiryFlagOf("2026-10-08T00:00:00Z", NOW)).toBe("expired");
  });
  it("flags the next two weeks as soon, and later dates not at all", () => {
    expect(expiryFlagOf("2026-10-15T00:00:00Z", NOW)).toBe("soon");
    expect(expiryFlagOf("2026-11-30T00:00:00Z", NOW)).toBeNull();
  });
});
