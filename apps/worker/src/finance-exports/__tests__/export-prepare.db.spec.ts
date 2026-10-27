import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "@eyadex/db";
import { DatabaseError } from "@eyadex/db";

import { PgExportStore } from "../persistence/pg-export-store.ts";
import { holdLock, waitForUngranted } from "./export-lock.ts";
import { owner, readExport, secondsFromDbNow, urls } from "./export-fixtures.ts";
import { bindPrepare } from "./export-prepare-cases.db.ts";
import {
  assignBranch,
  clearAssignment,
  controls,
  deactivateBranch,
  dropFinance,
  grant,
  insertBranch,
  leaseExport,
  stopRunning,
  openMember,
  otherMembership,
  revoke,
  seedControls,
  setFinance,
} from "./export-prepare-fixtures.ts";
import { waitForAccessWaiter } from "./export-prepare-lock.ts";
import "./export-prepare-cases.db.ts";

let app: Database;
let platformDb: Database;
let store: PgExportStore;
let platform: PgExportStore;

beforeAll(() => {
  const ids = { newId: randomUUID };
  const platformUrl = process.env["EYADEX_TEST_PLATFORM_URL"];
  if (platformUrl === undefined || platformUrl === "") {
    throw new Error("EYADEX_TEST_PLATFORM_URL is not set");
  }
  app = createDatabase({
    url: urls().app,
    role: "eyadex_app",
    ids,
    transactionTimeoutMs: 20_000,
  });
  platformDb = createDatabase({
    url: platformUrl,
    role: "eyadex_platform",
    ids,
    transactionTimeoutMs: 20_000,
  });
  store = new PgExportStore(app, ids);
  platform = new PgExportStore(platformDb, ids);
  bindPrepare({ app, store, platform });
});

afterAll(async () => {
  await Promise.all([app?.close(), platformDb?.close()]);
});

const fence = (clinicId: string, exportId: string) => ({
  clinicId,
  exportId,
  attempt: 1,
  leaseOwner: "worker-a",
});

describe("prepare leased export denials", () => {
  it("same store refuses clinic, finance, branch, and scope changes after a ready call", async () => {
    const keys = [
      "view:report_takings:clinic",
      "view:report_takings:branch",
      "view:payments:clinic",
    ];
    for (const change of [
      (clinicId: string) =>
        owner(`UPDATE clinics SET status = 'suspended' WHERE id = '${clinicId}'`),
      (clinicId: string) =>
        owner(
          `UPDATE clinics SET status = 'active', expires_at = clock_timestamp() WHERE id = '${clinicId}'`,
        ),
      (clinicId: string) => setFinance(clinicId, false),
      (clinicId: string) => dropFinance(clinicId),
    ]) {
      const world = openMember(keys);
      const leased = leaseExport(world, {
        report: "daily_takings",
        scope: "clinic",
        branchIds: [],
        groupBy: "day",
      });
      expect((await store.prepareLeasedJob(fence(world.clinicId, leased.exportId))).kind).toBe(
        "ready",
      );
      change(world.clinicId);
      expect(await store.prepareLeasedJob(fence(world.clinicId, leased.exportId))).toEqual({
        kind: "forbidden",
      });
    }

    const narrowed = openMember(keys);
    const narrowLease = leaseExport(narrowed, {
      report: "daily_takings",
      scope: "clinic",
      branchIds: [],
      groupBy: "day",
    });
    expect(
      (await store.prepareLeasedJob(fence(narrowed.clinicId, narrowLease.exportId))).kind,
    ).toBe("ready");
    revoke(narrowed.clinicId, narrowed.roleId, "view:report_takings:clinic");
    revoke(narrowed.clinicId, narrowed.roleId, "view:payments:clinic");
    grant(narrowed.clinicId, narrowed.roleId, ["view:payments:branch"]);
    expect(await store.prepareLeasedJob(fence(narrowed.clinicId, narrowLease.exportId))).toEqual({
      kind: "forbidden",
    });

    const branchWorld = openMember(["view:report_patients:branch", "view:payments:branch"], false);
    const east = insertBranch(branchWorld.clinicId, true);
    assignBranch(branchWorld.clinicId, branchWorld.membershipId, east);
    const removed = leaseExport(branchWorld, {
      report: "refunds",
      scope: "branch",
      branchIds: [east],
    });
    expect((await store.prepareLeasedJob(fence(branchWorld.clinicId, removed.exportId))).kind).toBe(
      "ready",
    );
    clearAssignment(branchWorld.clinicId, branchWorld.membershipId, east);
    expect(await store.prepareLeasedJob(fence(branchWorld.clinicId, removed.exportId))).toEqual({
      kind: "forbidden",
    });
    stopRunning(branchWorld.clinicId, removed.exportId);
    assignBranch(branchWorld.clinicId, branchWorld.membershipId, east);
    const stopped = leaseExport(branchWorld, {
      report: "refunds",
      scope: "branch",
      branchIds: [east],
    });
    expect((await store.prepareLeasedJob(fence(branchWorld.clinicId, stopped.exportId))).kind).toBe(
      "ready",
    );
    deactivateBranch(branchWorld.clinicId, east);
    expect(await store.prepareLeasedJob(fence(branchWorld.clinicId, stopped.exportId))).toEqual({
      kind: "forbidden",
    });
  });

  it("does not widen frozen params when the grant or the branch list grows", async () => {
    const world = openMember(["view:report_patients:branch", "view:payments:branch"], false);
    const east = insertBranch(world.clinicId, true);
    assignBranch(world.clinicId, world.membershipId, east);
    const leased = leaseExport(world, { report: "refunds", scope: "branch", branchIds: [east] });
    expect((await store.prepareLeasedJob(fence(world.clinicId, leased.exportId))).kind).toBe(
      "ready",
    );
    grant(world.clinicId, world.roleId, ["view:report_patients:clinic", "view:payments:clinic"]);
    const extra = insertBranch(world.clinicId, true);
    assignBranch(world.clinicId, world.membershipId, extra);
    expect(await store.prepareLeasedJob(fence(world.clinicId, leased.exportId))).toEqual({
      kind: "ready",
      job: {
        requestedBy: world.membershipId,
        report: "refunds",
        format: "csv",
        scope: "branch",
        params: leased.params,
        userId: world.userId,
      },
    });
  });

  it("fails closed for own stand-ins, unsupported scopes, another clinic, and bad params", async () => {
    for (const covering of ["branch", "clinic"] as const) {
      const world = openMember(["view:report_own:own", `view:invoices:${covering}`]);
      const leased = leaseExport(world, { report: "own_summary", scope: "own", branchIds: [] });
      expect(await store.prepareLeasedJob(fence(world.clinicId, leased.exportId))).toEqual({
        kind: "forbidden",
      });
    }
    const credit = openMember(["view:report_patients:clinic", "view:payments:clinic"]);
    const badScope = leaseExport(credit, {
      report: "patient_credit",
      scope: "branch",
      branchIds: [],
    });
    const eventId = seedControls(credit.clinicId, badScope.exportId);
    const before = controls(credit.clinicId, badScope.exportId, eventId);
    expect(await store.prepareLeasedJob(fence(credit.clinicId, badScope.exportId))).toEqual({
      kind: "forbidden",
    });
    expect(controls(credit.clinicId, badScope.exportId, eventId)).toEqual(before);
    stopRunning(credit.clinicId, badScope.exportId);
    const ownRows = leaseExport(credit, { report: "by_service", scope: "own", branchIds: [] });
    expect(await store.prepareLeasedJob(fence(credit.clinicId, ownRows.exportId))).toEqual({
      kind: "forbidden",
    });
    stopRunning(credit.clinicId, ownRows.exportId);
    const elsewhere = leaseExport(credit, {
      report: "patient_credit",
      scope: "clinic",
      branchIds: [],
      requestedBy: otherMembership(credit),
    });
    expect(await store.prepareLeasedJob(fence(credit.clinicId, elsewhere.exportId))).toEqual({
      kind: "forbidden",
    });
    stopRunning(credit.clinicId, elsewhere.exportId);
    const broken = leaseExport(credit, { report: "daily_takings", scope: "clinic", branchIds: [] });
    owner(
      `UPDATE finance_report_exports SET params = '{"from":"2026-02-30"}'::jsonb
        WHERE clinic_id = '${credit.clinicId}' AND id = '${broken.exportId}'`,
    );
    expect(await store.prepareLeasedJob(fence(credit.clinicId, broken.exportId))).toEqual({
      kind: "invalid_params",
    });
  });

  it("refuses the platform role without leaking the row", async () => {
    const world = openMember(["view:report_takings:clinic", "view:payments:clinic"]);
    const marker = "prepare-marker-7f3a";
    const leased = leaseExport(world, {
      report: "daily_takings",
      scope: "clinic",
      branchIds: [randomUUID()],
      groupBy: "day",
    });
    owner(
      `UPDATE finance_report_exports SET params = params || '{"marker":"${marker}"}'::jsonb
        WHERE clinic_id = '${world.clinicId}' AND id = '${leased.exportId}'`,
    );
    const refused = await platform.prepareLeasedJob(fence(world.clinicId, leased.exportId)).then(
      () => {
        throw new Error("platform prepare was accepted");
      },
      (caught: unknown) => caught,
    );
    expect(refused).toBeInstanceOf(DatabaseError);
    expect((refused as DatabaseError).code).toBe("42501");
    expect(JSON.stringify(refused)).not.toContain(marker);
    expect(JSON.stringify(refused)).not.toContain(world.userId);
  });

  it("returns lost_lease when an unchanged export lock outlives the lease", async () => {
    await outlives(
      (clinicId, exportId) =>
        `SELECT id FROM finance_report_exports WHERE clinic_id = '${clinicId}' AND id = '${exportId}' FOR UPDATE`,
      () => waitForUngranted("finance_report_exports"),
    );
  });

  it("returns lost_lease when a memberships lock outlasts a lease the fence already held", async () => {
    await outlives(
      () => "LOCK TABLE memberships IN ACCESS EXCLUSIVE MODE",
      async () => {
        const seen = await waitForAccessWaiter();
        expect(seen.self).toBe(1);
        expect(seen.waiters).toBe(1);
      },
    );
  });
});

async function outlives(
  lockSql: (clinicId: string, exportId: string) => string,
  observe: () => Promise<void>,
): Promise<void> {
  const world = openMember(["view:report_takings:clinic", "view:payments:clinic"]);
  const leased = leaseExport(world, {
    report: "daily_takings",
    scope: "clinic",
    branchIds: [],
    groupBy: "day",
  });
  owner(
    `UPDATE finance_report_exports SET lease_until = clock_timestamp() + interval '3 seconds'
      WHERE clinic_id = '${world.clinicId}' AND id = '${leased.exportId}'`,
  );
  const hold = holdLock(lockSql(world.clinicId, leased.exportId), 6);
  const until = () => secondsFromDbNow(readExport(world.clinicId, leased.exportId)!.lease_until!);
  try {
    await hold.ready;
    expect(until()).toBeGreaterThan(0);
    const pending = store.prepareLeasedJob(fence(world.clinicId, leased.exportId));
    await observe();
    expect(until()).toBeGreaterThan(0);
    await expect(pending).resolves.toEqual({ kind: "lost_lease" });
    await hold.done;
    expect(until()).toBeLessThan(0);
  } finally {
    hold.stop();
    await hold.done.catch(() => undefined);
  }
}
