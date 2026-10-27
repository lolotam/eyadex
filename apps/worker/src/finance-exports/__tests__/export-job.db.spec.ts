import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, sql } from "@eyadex/db";

import { PgExportStore } from "../persistence/pg-export-store.ts";
import { bindJob, closeJob, fenceOf, jobDb, rowJson } from "./export-job-cases.db.ts";
import { insertExport, markRunning, owner, seedMember, seedWorld } from "./export-fixtures.ts";

const need = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
};

beforeAll(() => {
  const ids = { newId: randomUUID };
  const app = createDatabase({
    url: need("EYADEX_TEST_APP_URL"),
    role: "eyadex_app",
    ids,
    transactionTimeoutMs: 20_000,
  });
  const platformDb = createDatabase({
    url: need("EYADEX_TEST_PLATFORM_URL"),
    role: "eyadex_platform",
    ids,
    transactionTimeoutMs: 20_000,
  });
  bindJob({
    app,
    platformDb,
    store: new PgExportStore(app, ids),
    platform: new PgExportStore(platformDb, ids),
  });
});

afterAll(() => closeJob());

describe("leased export job metadata", () => {
  it.each([
    {
      format: "csv" as const,
      report: "daily_takings",
      scope: "branch" as const,
      groupBy: "month" as const,
      branches: 2,
    },
    { format: "xlsx" as const, report: "by_service", scope: "own" as const, branches: 1 },
    { format: "xlsx" as const, report: "cash_closings", scope: "clinic" as const, branches: 0 },
  ])("returns frozen $format $scope metadata and does not expand reach", async (variant) => {
    const { app, store } = jobDb();
    const world = seedWorld();
    const member = seedMember(world);
    const branchIds = Array.from({ length: variant.branches }, () => randomUUID());
    const params: Record<string, unknown> = {
      from: "2026-03-01",
      to: "2026-03-31",
      language: "en",
      branchIds,
    };
    if ("groupBy" in variant) params["groupBy"] = variant.groupBy;
    const exportId = insertExport(world, {
      requestedBy: member.membershipId,
      report: variant.report,
      format: variant.format,
      scope: variant.scope,
      params: JSON.stringify(params),
    });
    markRunning(world.clinicId, exportId, { attempt: 1, owner: "worker-a", lease: "live" });
    const patientId = randomUUID();
    if (variant.scope === "own") {
      owner(
        `UPDATE finance_report_exports SET patient_ids = ARRAY['${patientId}']::uuid[] WHERE clinic_id = '${world.clinicId}' AND id = '${exportId}'`,
      );
    }
    const role = await app.withTenant(world.clinicId, async (tx) => {
      const rows = (await tx.execute(sql`SELECT current_user AS role`)) as { role: string }[];
      return rows[0]?.role;
    });
    expect(role).toBe("eyadex_app");
    const before = rowJson(world.clinicId, exportId);
    const job = await store.readLeasedJob(fenceOf(world.clinicId, exportId));
    expect(job).toEqual({
      requestedBy: member.membershipId,
      report: variant.report,
      format: variant.format,
      scope: variant.scope,
      params,
    });
    expect(Object.keys(job ?? {}).sort()).toEqual([
      "format",
      "params",
      "report",
      "requestedBy",
      "scope",
    ]);
    expect(JSON.stringify(job)).not.toContain(patientId);
    expect(rowJson(world.clinicId, exportId)).toEqual(before);
  });

  it.each([
    "wrong-owner",
    "wrong-attempt",
    "absent",
    "queued",
    "done",
    "failed",
    "expired",
    "purged",
    "expired-lease",
    "null-lease",
  ] as const)("returns null for %s", async (kind) => {
    const world = seedWorld();
    const member = seedMember(world);
    const exportId =
      kind === "absent"
        ? randomUUID()
        : insertExport(world, {
            requestedBy: member.membershipId,
            format: "csv",
            scope: "branch",
            report: "refunds",
          });
    const fence = fenceOf(world.clinicId, exportId);
    if (kind === "wrong-owner") {
      markRunning(world.clinicId, exportId, { attempt: 1, owner: "worker-a", lease: "live" });
      fence.leaseOwner = "worker-b";
    } else if (kind === "wrong-attempt") {
      markRunning(world.clinicId, exportId, { attempt: 1, owner: "worker-a", lease: "live" });
      fence.attempt = 2;
    } else if (kind === "expired-lease") {
      markRunning(world.clinicId, exportId, { attempt: 1, owner: "worker-a", lease: "expired" });
    } else if (kind === "null-lease") {
      markRunning(world.clinicId, exportId, { attempt: 1, owner: "worker-a", lease: "live" });
      owner(
        `UPDATE finance_report_exports SET lease_until = NULL WHERE clinic_id = '${world.clinicId}' AND id = '${exportId}'`,
      );
    } else if (kind === "queued") {
      owner(
        `UPDATE finance_report_exports SET attempt = 1, lease_owner = 'worker-a', lease_until = clock_timestamp() + interval '45 seconds' WHERE clinic_id = '${world.clinicId}' AND id = '${exportId}'`,
      );
    } else if (kind !== "absent") {
      markRunning(world.clinicId, exportId, { attempt: 1, owner: "worker-a", lease: "live" });
      owner(
        `UPDATE finance_report_exports SET status = '${kind}' WHERE clinic_id = '${world.clinicId}' AND id = '${exportId}'`,
      );
    }
    const before = kind === "absent" ? null : rowJson(world.clinicId, exportId);
    expect(await jobDb().store.readLeasedJob(fence)).toBeNull();
    if (before !== null) expect(rowJson(world.clinicId, exportId)).toEqual(before);
  });
});
