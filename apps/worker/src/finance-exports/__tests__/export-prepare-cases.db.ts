import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DatabaseError, sql, type Database } from "@eyadex/db";

import type { PgExportStore } from "../persistence/pg-export-store.ts";
import { owner } from "./export-fixtures.ts";
import {
  assignBranch,
  controls,
  insertBranch,
  insertRole,
  leaseExport,
  openMember,
  revoke,
  seedControls,
  stopRunning,
} from "./export-prepare-fixtures.ts";
import type { World } from "./export-fixtures.ts";

export interface PrepareContext {
  readonly app: Database;
  readonly store: PgExportStore;
  readonly platform: PgExportStore;
}

let current: PrepareContext | undefined;

export function bindPrepare(context: PrepareContext): void {
  current = context;
}

const store = () => {
  if (current === undefined) throw new Error("export prepare context is not bound");
  return current;
};

const fenceOf = (world: World, exportId: string, leaseOwner = "worker-a") => ({
  clinicId: world.clinicId,
  exportId,
  attempt: 1,
  leaseOwner,
});

async function readyThen(world: World, exportId: string, change: () => void): Promise<void> {
  expect((await store().store.prepareLeasedJob(fenceOf(world, exportId))).kind).toBe("ready");
  change();
  expect(await store().store.prepareLeasedJob(fenceOf(world, exportId))).toEqual({
    kind: "forbidden",
  });
}

describe("prepare leased export access", () => {
  it("returns the stored ceiling and current user as eyadex_app", async () => {
    const { app } = store();
    const world = openMember(["view:report_takings:clinic", "view:payments:clinic"]);
    const active = insertBranch(world.clinicId, true);
    const inactive = insertBranch(world.clinicId, false);
    const leased = leaseExport(world, {
      report: "daily_takings",
      scope: "clinic",
      branchIds: [active, inactive],
      groupBy: "day",
    });
    const eventId = seedControls(world.clinicId, leased.exportId);
    const before = controls(world.clinicId, leased.exportId, eventId);
    const role = await app.withTenant(world.clinicId, async (tx) => {
      const rows = (await tx.execute(sql`SELECT current_user AS role`)) as { role: string }[];
      return rows[0]?.role;
    });
    expect(role).toBe("eyadex_app");
    const ready = await store().store.prepareLeasedJob(fenceOf(world, leased.exportId));
    expect(ready).toEqual({
      kind: "ready",
      job: {
        requestedBy: world.membershipId,
        report: "daily_takings",
        format: "csv",
        scope: "clinic",
        params: leased.params,
        userId: world.userId,
      },
    });
    if (ready.kind === "ready") {
      expect(Object.keys(ready.job).sort()).toEqual([
        "format",
        "params",
        "report",
        "requestedBy",
        "scope",
        "userId",
      ]);
    }
    expect(controls(world.clinicId, leased.exportId, eventId)).toEqual(before);
  });

  it("keeps a branch ceiling to active assigned branches and an own ceiling to clinic branches", async () => {
    const branchWorld = openMember(["view:report_patients:branch", "view:payments:branch"], false);
    const east = insertBranch(branchWorld.clinicId, true);
    insertBranch(branchWorld.clinicId, false);
    assignBranch(branchWorld.clinicId, branchWorld.membershipId, east);
    const branch = leaseExport(branchWorld, {
      report: "refunds",
      scope: "branch",
      branchIds: [east],
    });
    expect(await store().store.prepareLeasedJob(fenceOf(branchWorld, branch.exportId))).toEqual({
      kind: "ready",
      job: {
        requestedBy: branchWorld.membershipId,
        report: "refunds",
        format: "csv",
        scope: "branch",
        params: branch.params,
        userId: branchWorld.userId,
      },
    });

    const ownWorld = openMember(["view:report_own:own", "view:invoices:own"]);
    const ownBranch = insertBranch(ownWorld.clinicId, false);
    const own = leaseExport(ownWorld, {
      report: "own_summary",
      scope: "own",
      branchIds: [ownBranch],
    });
    const patientId = randomUUID();
    owner(
      `UPDATE finance_report_exports SET patient_ids = ARRAY['${patientId}']::uuid[]
        WHERE clinic_id = '${ownWorld.clinicId}' AND id = '${own.exportId}'`,
    );
    const ownReady = await store().store.prepareLeasedJob(fenceOf(ownWorld, own.exportId));
    expect(ownReady).toEqual({
      kind: "ready",
      job: {
        requestedBy: ownWorld.membershipId,
        report: "own_summary",
        format: "csv",
        scope: "own",
        params: own.params,
        userId: ownWorld.userId,
      },
    });
    expect(JSON.stringify(ownReady)).not.toContain(patientId);
    const hidden = await store().app.withNoTenant((tx) =>
      tx.execute(sql`SELECT id FROM finance_report_exports WHERE id = ${own.exportId}`),
    );
    expect(hidden).toEqual([]);
    expect(
      await store().store.prepareLeasedJob({
        clinicId: ownWorld.otherClinicId,
        exportId: own.exportId,
        attempt: 1,
        leaseOwner: "worker-a",
      }),
    ).toEqual({ kind: "lost_lease" });
  });

  it.each(["missing", "wrong-owner", "wrong-clinic", "expired"] as const)(
    "denies a %s fence",
    async (kind) => {
      const world = openMember(["view:report_takings:clinic", "view:payments:clinic"]);
      const leased = leaseExport(world, {
        report: "daily_takings",
        scope: "clinic",
        branchIds: [],
        groupBy: "month",
        lease: kind === "expired" ? "expired" : "live",
      });
      const exportId = kind === "missing" ? randomUUID() : leased.exportId;
      const clinicId = kind === "wrong-clinic" ? world.otherClinicId : world.clinicId;
      const answer = await store().store.prepareLeasedJob({
        clinicId,
        exportId,
        attempt: 1,
        leaseOwner: kind === "wrong-owner" ? "worker-b" : "worker-a",
      });
      expect(answer).toEqual({ kind: "lost_lease" });
    },
  );

  it.each([
    [
      "view:report_analytics:clinic",
      "by_doctor",
      ["view:report_analytics:clinic", "view:invoices:clinic"],
    ],
    [
      "view:payments:clinic",
      "daily_takings",
      ["view:report_takings:clinic", "view:payments:clinic"],
    ],
    [
      "view:invoices:clinic",
      "outstanding",
      ["view:report_patients:clinic", "view:invoices:clinic"],
    ],
    [
      "view:cash_closings:clinic",
      "cash_closings",
      ["view:report_takings:clinic", "view:cash_closings:clinic"],
    ],
  ] as const)("same store refuses after %s is revoked", async (revoked, report, keys) => {
    const world = openMember(keys);
    const leased = leaseExport(world, {
      report,
      scope: "clinic",
      branchIds: [],
      ...(report === "daily_takings" ? { groupBy: "day" as const } : {}),
    });
    const eventId = seedControls(world.clinicId, leased.exportId);
    const before = controls(world.clinicId, leased.exportId, eventId);
    await readyThen(world, leased.exportId, () => revoke(world.clinicId, world.roleId, revoked));
    expect(controls(world.clinicId, leased.exportId, eventId)).toEqual(before);
  });

  it("same store refuses a switched or disabled role and a deactivated membership", async () => {
    const world = openMember(["view:report_takings:clinic", "view:payments:clinic"]);
    const leased = leaseExport(world, {
      report: "daily_takings",
      scope: "clinic",
      branchIds: [],
      groupBy: "day",
    });
    const empty = insertRole(world.clinicId);
    await readyThen(world, leased.exportId, () => {
      owner(
        `UPDATE memberships SET role_id = '${empty}'
          WHERE clinic_id = '${world.clinicId}' AND id = '${world.membershipId}'`,
      );
    });
    stopRunning(world.clinicId, leased.exportId);
    owner(
      `UPDATE memberships SET role_id = '${world.roleId}'
        WHERE clinic_id = '${world.clinicId}' AND id = '${world.membershipId}'`,
    );
    const again = leaseExport(world, {
      report: "daily_takings",
      scope: "clinic",
      branchIds: [],
      groupBy: "day",
    });
    await readyThen(world, again.exportId, () => {
      owner(
        `UPDATE roles SET is_active = false WHERE clinic_id = '${world.clinicId}' AND id = '${world.roleId}'`,
      );
    });
    stopRunning(world.clinicId, again.exportId);
    owner(
      `UPDATE roles SET is_active = true WHERE clinic_id = '${world.clinicId}' AND id = '${world.roleId}'`,
    );
    const third = leaseExport(world, {
      report: "daily_takings",
      scope: "clinic",
      branchIds: [],
      groupBy: "day",
    });
    await readyThen(world, third.exportId, () => {
      owner(
        `UPDATE memberships SET status = 'deactivated'
          WHERE clinic_id = '${world.clinicId}' AND id = '${world.membershipId}'`,
      );
    });
  });
});
