import { describe, expect, it } from "vitest";

import { branchesUsage, checkLimit, isInvitationLive, usersUsage } from "../limits.ts";

const now = new Date("2026-10-04T12:00:00.000Z");
const at = (offsetMs: number) => ({ expiresAt: new Date(now.getTime() + offsetMs) });

describe("isInvitationLive", () => {
  it("is live before expiry and not at or after the instant", () => {
    expect(isInvitationLive(at(1), now)).toBe(true);
    expect(isInvitationLive(at(0), now)).toBe(false);
    expect(isInvitationLive(at(-1), now)).toBe(false);
  });
});

describe("usersUsage", () => {
  it("counts active memberships plus live pending invitations only", () => {
    expect(usersUsage(3, [at(1000), at(0), at(-1000), at(60_000)], 10, now)).toEqual({
      used: 5,
      max: 10,
    });
  });

  it("is just the active memberships with no invitations", () => {
    expect(usersUsage(0, [], 5, now)).toEqual({ used: 0, max: 5 });
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
