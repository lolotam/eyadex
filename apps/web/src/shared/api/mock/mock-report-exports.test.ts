import { expect, it } from "vitest";
import { reportExportSchema } from "@eyadex/contracts/finance-reports";
import { setup, blobBytes } from "./mock-report-exports.test-kit";
import { createMockReportExports } from "./mock-report-exports";
import { exportJobsOf } from "./mock-report-export-state";
import { EXPORT_LIFETIME_MS } from "./mock-report-export-run";
import { personaWith, as } from "./mock-report-test-kit";
import { resetMockData, getState } from "./mock-store";
import { id } from "./mock-report-export.test-kit";
import { readXlsx, cellValues } from "./mock-export-xlsx.test-kit";

const fields = [
  "id",
  "report",
  "format",
  "status",
  "createdAt",
  "expiresAt",
  "byteSize",
  "rowCount",
].sort();

it.each(["csv", "xlsx"] as const)(
  "actual %s request/get/list/download phases, bytes and one persisted audit",
  async (format) => {
    const f = setup();
    const baseline = f.db.clinicAudit.length;
    const job = await f.request({ format });
    expect(job.status).toBe("queued");
    expect(f.db.clinicAudit).toHaveLength(baseline);
    expect((await f.api.getExport(f.persona, job.id)).export.status).toBe("queued");
    f.tick();
    const running = await f.api.listExports(f.persona, {});
    expect(running.items[0]?.status).toBe("running");
    expect(f.db.clinicAudit).toHaveLength(baseline);
    f.tick();
    const other = createMockReportExports(f.clock);
    const [done, list] = await Promise.all([
      f.api.getExport(f.persona, job.id),
      other.listExports(f.persona, {}),
    ]);
    expect(done.export.status).toBe("done");
    expect(Object.keys(done.export).sort()).toStrictEqual(fields);
    expect(Object.keys(list.items[0] ?? {}).sort()).toStrictEqual(fields);
    expect(reportExportSchema.safeParse(done.export).success).toBe(true);
    const blob = await other.downloadExport(f.persona, job.id.toUpperCase());
    const bytes = await blobBytes(blob);
    expect([...bytes]).toStrictEqual([...(job.artifact ?? [])]);
    expect(blob.size).toBe(job.byteSize);
    expect(job.rowCount).toBe(1);
    expect(job.expiresAt).toBe(new Date(f.clock().getTime() + EXPORT_LIFETIME_MS).toISOString());
    if (format === "csv") {
      expect(blob.type).toBe("text/csv; charset=utf-8");
      expect([...bytes.slice(0, 3)]).toStrictEqual([239, 187, 191]);
      expect(new TextDecoder().decode(bytes)).toBe(
        "Period,Branch,Method,Collected,Refunded,Net,Currency\r\n2026-05-10,Branch A,cash,3.000,0.000,3.000,KWD\r\n",
      );
    } else {
      expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      const xlsx = await readXlsx({ ok: true, bytes, rowCount: 1 });
      const sheet = xlsx.sheets[0];
      if (!sheet) throw new Error("Missing sheet");
      expect(cellValues(sheet).slice(1)).toStrictEqual([
        ["2026-05-10", "Branch A", "cash", "3.000", "0.000", "3.000", "KWD"],
      ]);
    }
    const original = structuredClone(f.db.clinicAudit);
    bytes.fill(0);
    done.export.status = "failed";
    expect([...(await blobBytes(await f.api.downloadExport(f.persona, job.id)))]).toStrictEqual(
      [...(job.artifact ?? [])],
    );
    expect(job.status).toBe("done");
    await f.api.getExport(f.persona, job.id);
    await f.api.listExports(f.persona, {});
    expect(f.db.clinicAudit).toStrictEqual(original);
    expect(f.db.clinicAudit).toHaveLength(baseline + 1);
    const saved = window.localStorage.getItem("eyadex:mock-db:v22") ?? "";
    expect(JSON.parse(saved).clinicAudit).toStrictEqual(f.db.clinicAudit);
    expect(saved).not.toContain('"artifact"');
    expect(saved).not.toContain('"ownPatientIds"');
    expect(saved).not.toContain('"requestedBy"');
    expect(JSON.stringify(f.db)).not.toContain('"artifact"');
  },
);

it("queue cap, same-member running refusal and queued allowance reuse admission without advancement", async () => {
  const f = setup();
  const jobs = [];
  for (let i = 0; i < 10; i++) jobs.push(await f.request());
  await expect(f.request()).rejects.toMatchObject({ code: "export_busy" });
  expect(jobs.every((j) => j.status === "queued")).toBe(true);
  f.tick();
  await f.api.getExport(f.persona, jobs[0]?.id ?? "");
  await expect(f.request()).rejects.toMatchObject({ code: "export_busy" });
  expect(exportJobsOf(f.db)).toHaveLength(10);
});

it("requester metadata survives report-key removal, but request/download do not", async () => {
  const f = setup();
  const done = await f.finish();
  const queued = await f.request();
  f.role.permissions = [];
  expect((await f.api.getExport(f.persona, done.id)).export.status).toBe("done");
  f.tick();
  const history = await f.api.listExports(f.persona, {});
  expect(history.total).toBe(2);
  expect(history.items.find((r) => r.id === queued.id)?.status).toBe("failed");
  await expect(f.request()).rejects.toMatchObject({ code: "forbidden" });
  await expect(f.api.downloadExport(f.persona, done.id)).rejects.toMatchObject({
    code: "forbidden",
  });
});

it("requester and clinic isolation applies to get/list/download and never advances foreign jobs", async () => {
  const f = setup();
  const job = await f.request();
  const foreign = personaWith(["view:report_takings:clinic", "view:payments:clinic"]);
  const otherClinic = f.db.clinics[1];
  if (!otherClinic) throw new Error("Missing clinic");
  f.db.features[otherClinic.id] = { ...f.db.features[f.ctx.clinicId], finance: true };
  f.tick();
  for (const actor of [foreign, as("clinic_admin", 1)]) {
    await expect(f.api.getExport(actor, job.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(f.api.downloadExport(actor, job.id)).rejects.toMatchObject({ code: "not_found" });
    expect((await f.api.listExports(actor, {})).total).toBe(0);
    expect(job.status).toBe("queued");
  }
  for (const value of ["bad", id(99999)])
    await expect(f.api.getExport(f.persona, value)).rejects.toMatchObject({ code: "not_found" });
});

it("stable >20 pagination, tie order, cursor isolation, limits and no store reorder", async () => {
  const f = setup();
  const ids: string[] = [];
  // Real jobs are completed in batches, rather than seeding pretend successful artifacts.
  for (let batch = 0; batch < 3; batch++) {
    for (let i = 0; i < 10; i++) ids.push((await f.request()).id);
    f.tick();
    await f.api.listExports(f.persona, {});
    f.tick();
    await f.api.listExports(f.persona, {});
  }
  const source = exportJobsOf(f.db).map((j) => j.id);
  const expected = [...exportJobsOf(f.db)]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .map((j) => j.id);
  const first = await f.api.listExports(f.persona, {});
  expect(first.items.map((j) => j.id)).toStrictEqual(expected.slice(0, 20));
  expect(first.nextCursor).toBe(expected[19]);
  const second = await f.api.listExports(f.persona, { cursor: first.nextCursor?.toUpperCase() });
  expect(second.items.map((j) => j.id)).toStrictEqual(expected.slice(20));
  expect(second.nextCursor).toBeNull();
  expect(second.total).toBe(30);
  expect((await f.api.listExports(f.persona, { limit: 100 })).items).toHaveLength(30);
  expect(exportJobsOf(f.db).map((j) => j.id)).toStrictEqual(source);
  const other = personaWith(["view:report_takings:clinic", "view:payments:clinic"]);
  const foreign = await f.api.requestExport(other, f.body);
  const otherClinic = f.db.clinics[1];
  if (!otherClinic) throw new Error("Missing clinic");
  f.db.features[otherClinic.id] = { ...f.db.features[f.ctx.clinicId], finance: true };
  const cross = await f.api.requestExport(as("clinic_admin", 1), f.body);
  for (const cursor of [id(88888), foreign.export.id, cross.export.id])
    expect(await f.api.listExports(f.persona, { cursor })).toStrictEqual({
      items: [],
      nextCursor: null,
      total: 30,
    });
  for (const query of [{ limit: 101 }, { limit: 0 }, { cursor: "bad" }, { extra: true }])
    await expect(f.api.listExports(f.persona, query)).rejects.toMatchObject({ code: "validation" });
  expect(ids).toHaveLength(30);
});

it("all terminal metadata retained and expiry is exclusive without repeated audit", async () => {
  const f = setup(true);
  const job = await f.finish();
  const audit = structuredClone(f.db.clinicAudit);
  f.tick(EXPORT_LIFETIME_MS - 1);
  expect((await f.api.getExport(f.persona, job.id)).export.status).toBe("done");
  f.tick(1);
  expect((await f.api.listExports(f.persona, {})).items[0]?.status).toBe("expired");
  expect(job.ownPatientIds).toBeNull();
  await expect(f.api.downloadExport(f.persona, job.id)).rejects.toMatchObject({
    code: "not_found",
  });
  expect(f.db.clinicAudit).toStrictEqual(audit);
});

it("reset during real ZIP progression cannot return stale metadata or persist stale audit", async () => {
  const f = setup();
  const job = await f.request({ format: "xlsx" });
  f.tick();
  await f.api.getExport(f.persona, job.id);
  f.tick();
  const work = f.api.getExport(f.persona, job.id);
  resetMockData();
  const fresh = getState();
  const before = structuredClone(fresh.clinicAudit);
  await expect(work).rejects.toMatchObject({ code: "not_found" });
  expect(fresh.clinicAudit).toStrictEqual(before);
  expect(exportJobsOf(fresh)).toHaveLength(0);
  expect(job.artifact).toBeNull();
  expect(f.db.clinicAudit.some((r) => r.entityId === job.id)).toBe(false);
});
