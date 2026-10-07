import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { routeEvents } from "../../shared/event-router.ts";
import { parseBranchDeactivated } from "../domain/branch-event.ts";
import { invitationSnapshot, isOrphaned, shownStatus } from "../domain/orphan-rule.ts";

const clinicId = randomUUID();
const valid = {
  clinicId,
  branchId: randomUUID(),
  actorUserId: randomUUID(),
  deactivatedAt: "2026-10-07T04:00:00.000Z",
};

describe("parseBranchDeactivated", () => {
  it("accepts the four fields for the event's own clinic", () => {
    expect(parseBranchDeactivated(valid, clinicId)).toEqual(valid);
  });
  it.each([
    ["another clinic", valid, randomUUID()],
    ["a null event clinic", valid, null],
    ["a bad uuid", { ...valid, branchId: "x" }, clinicId],
    ["a missing field", { ...valid, actorUserId: undefined }, clinicId],
    ["an extra field", { ...valid, email: "a@example.test" }, clinicId],
    ["a bad date", { ...valid, deactivatedAt: "yesterday" }, clinicId],
  ])("refuses %s", (_name, payload, eventClinic) => {
    expect(parseBranchDeactivated(payload, eventClinic)).toBeNull();
  });
});

describe("isOrphaned", () => {
  const base = { id: "i", status: "pending", allBranches: false, activeBranchCount: 0 } as const;
  it("cancels a pending, branch-limited invitation with no active branch", () => {
    expect(isOrphaned(base)).toBe(true);
  });
  it.each([
    ["an active branch left", { activeBranchCount: 1 }],
    ["all branches", { allBranches: true }],
    ["accepted", { status: "accepted" as const }],
    ["cancelled", { status: "cancelled" as const }],
  ])("keeps one with %s", (_name, change) => {
    expect(isOrphaned({ ...base, ...change })).toBe(false);
  });
});

describe("snapshots", () => {
  it("masks phone digits in names and sorts branch ids", () => {
    const snap = invitationSnapshot(
      {
        fullName: "Sara 99887766",
        email: "s@example.test",
        roleId: "r",
        roleNameAr: "طبيب 55667788",
        roleNameEn: "Doctor",
        allBranches: false,
        branchIds: ["b", "a"],
        expiresAt: new Date("2026-10-10T00:00:00Z"),
      },
      "cancelled",
    );
    expect(JSON.stringify(snap)).not.toMatch(/99887766|55667788/);
    expect(snap.branchIds).toEqual(["a", "b"]);
  });
  it("shows an expired pending invitation as expired", () => {
    const now = new Date("2026-10-10T00:00:00Z");
    expect(shownStatus(new Date("2026-10-09T00:00:00Z"), now)).toBe("expired");
    expect(shownStatus(new Date("2026-10-11T00:00:00Z"), now)).toBe("pending");
  });
});

describe("routeEvents", () => {
  it("claims exactly the mapped types and fails closed on anything else", async () => {
    const route = routeEvents({ "a.b": async () => ({ kind: "dispatched" }) });
    expect(route.types).toEqual(["a.b"]);
    const event = { id: "e", clinicId: null, payload: {}, attempts: 0, createdAt: new Date() };
    expect(await route.handle({ ...event, type: "a.b" })).toEqual({ kind: "dispatched" });
    expect(await route.handle({ ...event, type: "c.d" })).toEqual({
      kind: "failed",
      error: "unrouted",
    });
  });
});
