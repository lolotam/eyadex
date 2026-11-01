import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ApiClient } from "../api-client";
import { createMockApiClient } from "./mock-adapter";
import { fixture, invoice, payment, NOW } from "./mock-report-export.test-kit";
import { admin, personaWith } from "./mock-report-test-kit";
import { blobBytes } from "./mock-report-exports.test-kit";
import { cellValues, readXlsx } from "./mock-export-xlsx.test-kit";
import { exportJobsOf } from "./mock-report-export-state";
import { EXPORT_LIFETIME_MS, EXPORT_STEP_MS } from "./mock-report-export-run";

beforeEach(() => {
  // Only Date is faked: FileReader and real ZIP writing retain their normal async behavior.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());
const tick = (ms = EXPORT_STEP_MS) => vi.setSystemTime(Date.now() + ms);
const body = {
  report: "daily_takings",
  from: "2026-01-01",
  to: "2026-12-31",
  language: "en",
} as const;
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
  "root mock namespace builds and downloads real %s once across factory instances",
  async (format) => {
    const f = fixture();
    payment(f, 1, invoice(f, 1));
    const api: ApiClient = createMockApiClient();
    const second: ApiClient = createMockApiClient();
    const actor = admin();
    const baseline = f.db.clinicAudit.length;
    const queued = await api.reports.requestExport(actor, { ...body, format });
    expect(queued.export.status).toBe("queued");
    expect(queued.export.createdAt).toBe(NOW.toISOString());
    expect(Object.keys(queued.export).sort()).toStrictEqual(fields);
    expect((await second.reports.getExport(actor, queued.export.id)).export.status).toBe("queued");
    tick();
    expect((await api.reports.listExports(actor, {})).items[0]?.status).toBe("running");
    expect(f.db.clinicAudit).toHaveLength(baseline);
    tick();
    const [done, history] = await Promise.all([
      second.reports.getExport(actor, queued.export.id),
      api.reports.listExports(actor, {}),
    ]);
    expect(done.export.status).toBe("done");
    expect(Object.keys(done.export).sort()).toStrictEqual(fields);
    expect(history.items).toStrictEqual([done.export]);
    expect(done.export.rowCount).toBe(1);
    expect(done.export.expiresAt).toBe(new Date(Date.now() + EXPORT_LIFETIME_MS).toISOString());
    const job = exportJobsOf(f.db).find((row) => row.id === done.export.id);
    if (!job?.artifact) throw new Error("Missing real artifact");
    const blob = await api.reports.downloadExport(actor, done.export.id);
    const bytes = await blobBytes(blob);
    expect([...bytes]).toStrictEqual([...job.artifact]);
    expect(blob.size).toBe(job.artifact.byteLength);
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
    const audit = structuredClone(f.db.clinicAudit);
    expect(audit).toHaveLength(baseline + 1);
    await second.reports.downloadExport(actor, done.export.id);
    await api.reports.listExports(actor, {});
    tick(EXPORT_LIFETIME_MS - 1);
    expect((await api.reports.getExport(actor, done.export.id)).export.status).toBe("done");
    tick(1);
    expect((await second.reports.listExports(actor, {})).items[0]?.status).toBe("expired");
    await expect(api.reports.downloadExport(actor, done.export.id)).rejects.toMatchObject({
      code: "not_found",
    });
    expect(f.db.clinicAudit).toStrictEqual(audit);
  },
);

it("root mock preserves report data and the 366-day limit while accepting a 1096-day export", async () => {
  const f = fixture();
  payment(f, 1, invoice(f, 1));
  const api: ApiClient = createMockApiClient();
  const report = await api.reports.dailyTakings(admin(), {
    from: body.from,
    to: body.to,
  });
  expect(report.rows).toMatchObject([{ branchId: f.a.id, inMinor: "3000", netMinor: "3000" }]);
  const long = { from: "2024-01-01", to: "2026-12-31" };
  await expect(api.reports.dailyTakings(admin(), long)).rejects.toMatchObject({
    code: "report_range_too_long",
  });
  expect(
    (await api.reports.requestExport(admin(), { ...body, ...long, format: "csv" })).export.status,
  ).toBe("queued");
});

it("root mock enforces report keys without hiding requester-only metadata after revocation", async () => {
  fixture();
  const api: ApiClient = createMockApiClient();
  const actor = personaWith(["view:report_takings:clinic", "view:payments:clinic"]);
  const noKeys = personaWith([]);
  await expect(api.reports.requestExport(noKeys, { ...body, format: "csv" })).rejects.toMatchObject(
    { code: "forbidden" },
  );
  const queued = await api.reports.requestExport(actor, { ...body, format: "csv" });
  tick();
  await api.reports.getExport(actor, queued.export.id);
  tick();
  await api.reports.getExport(actor, queued.export.id);
  const db = (await import("./mock-store")).getState();
  const member = db.members.find((row) => row.id === actor.memberId);
  const role = db.roles.find((row) => row.id === member?.roleId);
  if (!role) throw new Error("Missing role");
  role.permissions = [];
  expect((await api.reports.getExport(actor, queued.export.id)).export.status).toBe("done");
  expect((await api.reports.listExports(actor, {})).total).toBe(1);
  expect((await api.reports.listExports(noKeys, {})).total).toBe(0);
  await expect(api.reports.getExport(noKeys, queued.export.id)).rejects.toMatchObject({
    code: "not_found",
  });
  await expect(api.reports.downloadExport(actor, queued.export.id)).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(api.reports.requestExport(actor, { ...body, format: "csv" })).rejects.toMatchObject({
    code: "forbidden",
  });
});
