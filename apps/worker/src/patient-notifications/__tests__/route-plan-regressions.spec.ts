import { describe, expect, it } from "vitest";

import { planRoutes } from "../domain/route-plan.ts";

const healthy = {
  verifiedAt: new Date("2026-10-01T00:00:00Z"),
  degradedAt: null,
  fromName: "Clinic",
  fromEmail: "clinic@example.invalid",
  replyTo: null,
};

describe("ambiguous notification attempts stay on their original route", () => {
  it.each(["primary", "fallback"] as const)("retries only %s while it remains usable", (slot) => {
    expect(planRoutes(healthy, healthy, slot)).toEqual([slot]);
  });

  it.each([
    ["missing", null],
    ["degraded", { ...healthy, degradedAt: healthy.verifiedAt }],
    ["unverified", { ...healthy, verifiedAt: null }],
  ])("never switches from a %s primary to fallback or platform", (_condition, primary) => {
    expect(planRoutes(primary, healthy, "primary")).toEqual([]);
  });

  it("never switches from a missing fallback to platform", () => {
    expect(planRoutes(healthy, null, "fallback")).toEqual([]);
  });
});
