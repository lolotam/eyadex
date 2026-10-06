import { describe, expect, it } from "vitest";

import { checkLimit, limitReachedDetails, usersUsage } from "../limits.ts";
import { resolveExpiry } from "../subscription.ts";

const now = new Date("2030-01-01T00:00:00Z");

describe("resolveExpiry (stories 9–12)", () => {
  it("a duration counts whole days from now", () => {
    expect(resolveExpiry({ kind: "duration", days: 30 }, now).toISOString()).toBe(
      "2030-01-31T00:00:00.000Z",
    );
  });

  it("an explicit date is taken as given, even in the past", () => {
    const past = new Date("2020-05-05T10:00:00Z");
    expect(resolveExpiry({ kind: "date", at: past }, now)).toEqual(past);
  });

  it("NEGATIVE: refuses a zero or fractional duration", () => {
    expect(() => resolveExpiry({ kind: "duration", days: 0 }, now)).toThrow(RangeError);
    expect(() => resolveExpiry({ kind: "duration", days: 1.5 }, now)).toThrow(RangeError);
  });
});

describe("limit_reached details (SUB-03 domain)", () => {
  it("deactivated users and cancelled/expired invitations are simply not in the counts", () => {
    // The adapter counts only active memberships and live pending invitations.
    expect(checkLimit(usersUsage(2, 0, 3)).kind).toBe("within");
  });

  it("at the limit → blocked, carrying resource, used and max", () => {
    const check = checkLimit(usersUsage(2, 1, 3));
    expect(limitReachedDetails("users", check)).toEqual({ resource: "users", used: 3, max: 3 });
  });

  it("within the limit → no details", () => {
    expect(limitReachedDetails("branches", checkLimit({ used: 1, max: 3 }))).toBeNull();
  });
});
