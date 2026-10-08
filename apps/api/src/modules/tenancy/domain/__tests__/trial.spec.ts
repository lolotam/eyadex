import { describe, expect, it } from "vitest";

import { trialEndsAt } from "../trial.ts";

// ADR-0016: a new clinic's trial ends 23:59:59 local, N days after the clinic's own today.
describe("trialEndsAt", () => {
  it("Asia/Kuwait: counts from the local date, which is already tomorrow in UTC terms", () => {
    // 01:00 on 1 February in Kuwait is still 31 January in UTC.
    const now = new Date("2026-01-31T22:00:00Z");
    expect(trialEndsAt(14, "Asia/Kuwait", now).toISOString()).toBe("2026-02-15T20:59:59.000Z");
  });

  it("crosses a month boundary (31 January + 30 days = 2 March)", () => {
    const now = new Date("2026-01-31T10:00:00Z");
    expect(trialEndsAt(30, "Asia/Kuwait", now).toISOString()).toBe("2026-03-02T20:59:59.000Z");
  });

  it("Africa/Cairo: uses the offset of the target day across the DST change", () => {
    // Winter (UTC+2) today, summer (UTC+3) on the last day.
    const now = new Date("2026-04-20T10:00:00Z");
    expect(trialEndsAt(14, "Africa/Cairo", now).toISOString()).toBe("2026-05-04T20:59:59.000Z");
    // Both days in winter.
    const winter = new Date("2026-01-10T10:00:00Z");
    expect(trialEndsAt(5, "Africa/Cairo", winter).toISOString()).toBe("2026-01-15T21:59:59.000Z");
  });

  it("NEGATIVE: refuses a day count outside 1–365", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(() => trialEndsAt(0, "Asia/Kuwait", now)).toThrow(RangeError);
    expect(() => trialEndsAt(366, "Asia/Kuwait", now)).toThrow(RangeError);
    expect(() => trialEndsAt(1.5, "Asia/Kuwait", now)).toThrow(RangeError);
  });
});
