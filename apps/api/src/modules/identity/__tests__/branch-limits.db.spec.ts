import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  APP,
  closeHarness,
  openHarness,
  type Harness,
} from "../auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers, get } from "./access-fixtures.ts";
import {
  activeBranchIds,
  branchAction,
  branchAudit,
  code,
  createBranch,
  setMaxBranches,
} from "./branch-fixtures.ts";

// SUB-03 (branches), OD-7 under concurrency, and the cached branch scope (ADR-0011).
let h: Harness;

/** A fresh clinic with exactly two active branches (the doctor's plus one made over the API). */
async function clinicWithTwoBranches() {
  const members = await clinicWithMembers(h);
  await setMaxBranches(h, members.admin.clinicId, 10);
  if ((await createBranch(h, members.admin.cookie)).statusCode !== 201) throw new Error("create");
  return members;
}

beforeAll(async () => {
  h = await openHarness({}, true);
});

afterAll(async () => {
  await closeHarness(h);
});

describe("SUB-03: the branch limit", () => {
  it("blocks at the limit with the numbers; a deactivated branch frees a slot", async () => {
    const { admin } = await clinicWithTwoBranches();
    const active = await activeBranchIds(h, admin.clinicId);
    await setMaxBranches(h, admin.clinicId, active.length);
    const blocked = await createBranch(h, admin.cookie);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({
      code: "limit_reached",
      details: { resource: "branches", used: active.length, max: active.length },
    });
    expect((await branchAction(h, admin.cookie, active[0]!, "deactivate")).statusCode).toBe(200);
    expect((await createBranch(h, admin.cookie)).statusCode).toBe(201);
    // At the limit again: bringing the old branch back counts like a new one.
    const back = await branchAction(h, admin.cookie, active[0]!, "reactivate");
    expect(back.statusCode).toBe(409);
    expect(back.json()).toMatchObject({ code: "limit_reached", details: { resource: "branches" } });
    await setMaxBranches(h, admin.clinicId, active.length + 1);
    const ok = await branchAction(h, admin.cookie, active[0]!, "reactivate");
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ isActive: true });
    const audit = (await branchAudit(h, admin.clinicId, active[0]!)).filter(
      (r) => r["action"] !== "branch.created",
    );
    expect(audit.map((r) => r["action"])).toEqual(["branch.deactivated", "branch.reactivated"]);
    expect(audit[1]!["details"]).toMatchObject({
      before: { isActive: false },
      after: { isActive: true },
    });
  });

  it("two parallel creates at limit-1 → exactly one 201", async () => {
    const { admin } = await clinicWithMembers(h);
    const active = await activeBranchIds(h, admin.clinicId);
    await setMaxBranches(h, admin.clinicId, active.length + 1);
    const results = await Promise.all([
      createBranch(h, admin.cookie),
      createBranch(h, admin.cookie),
    ]);
    const statuses = results.map((r) => r.statusCode).sort();
    expect(statuses).toEqual([201, 409]);
    expect(results.map(code)).toContain("limit_reached");
    expect(await activeBranchIds(h, admin.clinicId)).toHaveLength(active.length + 1);
  });
});

describe("OD-7: the last active branch", () => {
  it("refuses deactivating the last active branch", async () => {
    const { admin, doctor } = await clinicWithTwoBranches();
    // Picked by role, not by sort order: the doctor's branch id is a v4 and the created one a v7, so
    // ORDER BY id is not stable, and the doctor relies on that branch alone (ADR-0012 would answer
    // branch_has_exclusive_members if it went first).
    const first = (await activeBranchIds(h, admin.clinicId)).find((id) => id !== doctor.branchId);
    const last = doctor.branchId;
    expect((await branchAction(h, admin.cookie, first!, "deactivate")).statusCode).toBe(200);
    const res = await branchAction(h, admin.cookie, last, "deactivate");
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe("last_active_branch");
    const statusRows = async (id: string) =>
      (await branchAudit(h, admin.clinicId, id)).filter((r) => r["action"] !== "branch.created");
    expect(await statusRows(last)).toHaveLength(0);
    // Deactivating an inactive branch changes nothing and audits nothing.
    expect((await branchAction(h, admin.cookie, first!, "deactivate")).statusCode).toBe(200);
    expect(await statusRows(first!)).toHaveLength(1);
  });

  it("two parallel deactivations of the last two active branches → exactly one succeeds", async () => {
    const { admin } = await clinicWithTwoBranches();
    const active = await activeBranchIds(h, admin.clinicId);
    expect(active).toHaveLength(2);
    const results = await Promise.all(
      active.map((id) => branchAction(h, admin.cookie, id, "deactivate")),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await activeBranchIds(h, admin.clinicId)).toHaveLength(1);
  });
});

describe("cached branch scope", () => {
  it("/v1/me drops a deactivated branch on the next request", async () => {
    const { admin, doctor } = await clinicWithTwoBranches();
    const before = await get(h, "/v1/me", doctor.cookie);
    expect(before.json().branchIds).toEqual([doctor.branchId]);
    const confirm = { confirmStrandedMembers: true };
    const off = await branchAction(h, admin.cookie, doctor.branchId, "deactivate", APP, confirm);
    expect(off.statusCode).toBe(200);
    // The doctor keeps the membership but no branch: nothing branch-scoped is reachable.
    const after = await get(h, "/v1/me", doctor.cookie);
    expect(after.statusCode).toBe(200);
    expect(after.json().branchIds).toEqual([]);
    expect((await branchAction(h, admin.cookie, doctor.branchId, "reactivate")).statusCode).toBe(
      200,
    );
    expect((await get(h, "/v1/me", doctor.cookie)).json().branchIds).toEqual([doctor.branchId]);
  });
});
