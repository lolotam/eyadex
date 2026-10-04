import { describe, expect, it } from "vitest";

import { branchesUsage, checkLimit, usersUsage } from "../limits.ts";

// Which invitations are still live (expires_at > now) is counted in the database by the identity
// adapter (PgSeatUsageReader); the domain only adds the two counts.
describe("usersUsage", () => {
  it("counts active memberships plus live pending invitations", () => {
    expect(usersUsage(3, 2, 10)).toEqual({ used: 5, max: 10 });
  });

  it("is just the active memberships with no live invitations", () => {
    expect(usersUsage(0, 0, 5)).toEqual({ used: 0, max: 5 });
  });
});

describe("branchesUsage", () => {
  it("is active branches against max_branches", () => {
    expect(branchesUsage(2, 3)).toEqual({ used: 2, max: 3 });
  });
});

describe("checkLimit", () => {
  it("allows reaching the limit exactly", () => {
    expect(checkLimit({ used: 2, max: 3 })).toEqual({ kind: "within", used: 2, max: 3 });
  });

  it("refuses going past the limit and reports usage", () => {
    expect(checkLimit({ used: 3, max: 3 })).toEqual({ kind: "exceeded", used: 3, max: 3 });
    expect(checkLimit({ used: 1, max: 3 }, 3)).toEqual({ kind: "exceeded", used: 1, max: 3 });
  });

  it("treats usage already above the limit as exceeded", () => {
    expect(checkLimit({ used: 5, max: 3 }).kind).toBe("exceeded");
  });

  it("refuses a non-positive or fractional addition", () => {
    expect(() => checkLimit({ used: 0, max: 3 }, 0)).toThrow(RangeError);
    expect(() => checkLimit({ used: 0, max: 3 }, 1.5)).toThrow(RangeError);
  });
});
