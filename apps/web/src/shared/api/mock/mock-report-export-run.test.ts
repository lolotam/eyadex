import { expect, it } from "vitest";
import { REPORT_IDS, type ReportId } from "@eyadex/contracts/finance-reports";
import { scrubAuditText } from "@eyadex/observability/audit-text";
import { admitReportExport } from "./mock-report-export-admission";
import { exportJobsOf, publicExportOf } from "./mock-report-export-state";
import { advanceReportExport, EXPORT_LIFETIME_MS, EXPORT_STEP_MS } from "./mock-report-export-run";
import {
  fixture,
  invoice,
  payment,
  refund,
  credit,
  closing,
  makeOwn,
  NOW,
} from "./mock-report-export.test-kit";
import { admin, as, personaWith } from "./mock-report-test-kit";
import { artifact } from "./mock-export-fixtures.test-kit";
import { cellValues, readXlsx } from "./mock-export-xlsx.test-kit";
import { recheckExportAccess } from "./mock-report-export-access";
import { readReportExport } from "./mock-report-export-read";

function setup(report: ReportId = "daily_takings", format: "csv" | "xlsx" = "csv") {
  const f = fixture();
  f.db.appointments = [];
  f.db.medical.visits = [];
  makeOwn(f, f.patient.id);
  const inv = invoice(f, 1);
  payment(f, 1, inv);
  refund(f, 1, inv);
  credit(f, 1);
  closing(f, 1, "synthetic-private-note");
  const actor = report === "own_summary" ? as("doctor") : admin();
  admitReportExport(
    f.db,
    actor,
    {
      report,
      format,
      language: "en",
      from: "2026-01-01",
      to: "2026-12-31",
    },
    NOW,
  );
  const job = exportJobsOf(f.db)[0];
  if (!job) throw new Error("Missing admitted job");
  let time = NOW.getTime();
  const clock = () => new Date(time);
  const advance = () => advanceReportExport(f.db, job, clock);
  const tick = (delta = EXPORT_STEP_MS) => {
    time += delta;
  };
  const finish = async () => {
    tick();
    await advance();
    tick();
    await advance();
  };
  const audits = () => f.db.clinicAudit.filter((row) => row.entityId === job.id);
  return { ...f, job, clock, advance, tick, finish, audits, inv };
}

it("observable fixed queued/running/done steps publish actual CSV bytes once with finish-clock expiry", async () => {
  const f = setup();
  const baseline = structuredClone(f.db.clinicAudit);
  await f.advance();
  expect(f.job.status).toBe("queued");
  f.tick(EXPORT_STEP_MS - 1);
  await f.advance();
  expect(f.job.status).toBe("queued");
  f.tick(1);
  await f.advance();
  expect(f.job.status).toBe("running");
  expect(f.job.artifact).toBeNull();
  expect(f.db.clinicAudit).toStrictEqual(baseline);
  f.tick(EXPORT_STEP_MS - 1);
  await f.advance();
  expect(f.job.status).toBe("running");
  f.tick(1);
  const access = recheckExportAccess(f.db, f.job, f.clock());
  if (access.kind !== "ready") throw new Error("Missing access");
  const rows = readReportExport(access.ctx, f.job.report, f.job.params, f.clock()).rows;
  const expected = artifact(f.job.report, rows);
  await f.advance();
  expect(f.job.status).toBe("done");
  expect(f.job.artifact).toStrictEqual(expected.bytes);
  expect(expected.records.slice(1)).toStrictEqual([
    ["2026-05-10", "Branch A", "cash", "3.000", "1.000", "2.000", "KWD"],
  ]);
  expect(f.job.rowCount).toBe(1);
  expect(f.job.byteSize).toBe(expected.bytes.byteLength);
  expect(f.job.expiresAt).toBe(new Date(f.clock().getTime() + EXPORT_LIFETIME_MS).toISOString());
  expect(f.audits()).toHaveLength(1);
  expect(f.audits()[0]?.createdAt).toBe(f.clock().toISOString());
  const published = structuredClone(f.audits());
  await Promise.all([f.advance(), f.advance(), f.advance()]);
  expect(f.audits()).toStrictEqual(published);
  expect(exportJobsOf(f.db)).toContain(f.job);
  expect(Object.keys(publicExportOf(f.job))).not.toContain("artifact");
  expect(Object.keys(publicExportOf(f.job))).not.toContain("ownPatientIds");
});

it("a clock jump still exposes running and the next fixed step builds from current data", async () => {
  const f = setup();
  f.tick(50 * EXPORT_STEP_MS);
  await f.advance();
  expect(f.job.status).toBe("running");
  await f.advance();
  expect(f.job.status).toBe("running");
  payment(f, 2, f.inv, { amountMinor: "4000" });
  f.tick();
  await f.advance();
  expect(new TextDecoder().decode(f.job.artifact ?? new Uint8Array())).toContain(
    "7.000,1.000,6.000",
  );
});

it("concurrent real XLSX builds coalesce and keep exactly one genuine artifact and audit", async () => {
  const f = setup("outstanding", "xlsx");
  f.tick();
  await f.advance();
  f.tick();
  const attempts = [f.advance(), f.advance(), f.advance()];
  expect(f.job.status).toBe("running");
  expect(f.audits()).toHaveLength(0);
  await Promise.all(attempts);
  const bytes = f.job.artifact;
  if (!bytes) throw new Error("Missing actual XLSX");
  const xlsx = await readXlsx({ ok: true, bytes, rowCount: f.job.rowCount ?? -1 });
  const sheet = xlsx.sheets[0];
  if (!sheet) throw new Error("Missing sheet");
  expect(cellValues(sheet).slice(1)).toStrictEqual([
    [
      "INV-1",
      "Branch A",
      "2026-05-10",
      f.patient.fullName,
      "9.000",
      "3.000",
      "6.000",
      "over_90",
      "KWD",
    ],
  ]);
  expect(f.job.rowCount).toBe(1);
  expect(f.job.byteSize).toBe(bytes.byteLength);
  expect(f.job.artifact).toBe(bytes);
  expect(f.audits()).toHaveLength(1);
  await f.advance();
  expect(f.job.artifact).toBe(bytes);
  expect(f.audits()).toHaveLength(1);
});

it.each(REPORT_IDS)(
  "publication category and exact validated details for %s survive expiry",
  async (report) => {
    const f = setup(report);
    await f.finish();
    expect(f.job.status).toBe("done");
    expect(f.audits()).toHaveLength(1);
    const row = f.audits()[0];
    if (!row) throw new Error("Missing publication audit");
    expect(row.category).toBe(
      ["outstanding", "patient_credit", "refunds", "discounts"].includes(report)
        ? "patient_access"
        : "administrative",
    );
    expect(row.action).toBe("finance_report.exported");
    expect(row.entity).toBe("finance_report_export");
    expect(row.before).toBeNull();
    expect(row.actorName).toBe(
      scrubAuditText(report === "own_summary" ? f.doctor.fullName : f.member.fullName),
    );
    expect(row.after).toStrictEqual({
      report,
      from: "2026-01-01",
      to: "2026-12-31",
      branchIds: f.job.params.branchIds.map((id) => id.toLowerCase()),
      rowCount: 1,
    });
    expect(Object.keys(row.after ?? {}).sort()).toStrictEqual([
      "branchIds",
      "from",
      "report",
      "rowCount",
      "to",
    ]);
    const detail = JSON.stringify(row.after);
    for (const forbidden of [
      f.patient.id,
      f.patient.fullName,
      f.doctor.fullName,
      "synthetic-private-note",
      "synthetic refund",
      "synthetic discount",
    ])
      expect(detail).not.toContain(forbidden);
    expect(f.db.platformAudit.filter((event) => event.entityId === f.job.id)).toHaveLength(0);
    const original = structuredClone(row);
    const metadata = publicExportOf(f.job);
    f.tick(EXPORT_LIFETIME_MS - 1);
    await f.advance();
    expect(f.job.status).toBe("done");
    expect(f.job.artifact).not.toBeNull();
    f.tick(1);
    await f.advance();
    expect(f.job.status).toBe("expired");
    expect(f.job.artifact).toBeNull();
    expect(f.job.ownPatientIds).toBeNull();
    expect(publicExportOf(f.job)).toStrictEqual({ ...metadata, status: "expired" });
    expect(f.audits()).toStrictEqual([original]);
    expect(exportJobsOf(f.db)).toContain(f.job);
  },
);

it("own set is exactly qualifying contributions, including a valid empty complete set", async () => {
  const f = setup("own_summary");
  const other = f.db.patients.find((p) => p.clinicId === f.ctx.clinicId && p.id !== f.patient.id);
  if (!other) throw new Error("Missing second patient");
  makeOwn(f, other.id);
  invoice(f, 2, { patientId: other.id, issuedAt: "2025-01-01T00:00:00.000Z" });
  await f.finish();
  expect(f.job.status).toBe("done");
  expect(f.job.ownPatientIds).toStrictEqual([f.patient.id]);
  const empty = setup("own_summary");
  empty.db.appointments = [];
  empty.db.medical.visits = [];
  await empty.finish();
  expect(empty.job.status).toBe("done");
  expect(empty.job.ownPatientIds).toStrictEqual([]);
  expect(empty.job.rowCount).toBe(0);
  expect(empty.job.artifact?.byteLength).toBeGreaterThan(0);
  expect(empty.audits()[0]?.after?.["rowCount"]).toBe(0);
});

it("already purged own export keeps its original ledger until original expiry, without new audit", async () => {
  const f = setup("own_summary");
  await f.finish();
  const original = structuredClone(f.audits());
  const expiry = f.job.expiresAt;
  f.job.status = "purged";
  f.job.artifact = null;
  f.tick(EXPORT_LIFETIME_MS - 1);
  await f.advance();
  expect(f.job.status).toBe("purged");
  expect(f.job.ownPatientIds).toStrictEqual([f.patient.id]);
  expect(f.job.expiresAt).toBe(expiry);
  f.tick(1);
  await f.advance();
  expect(f.job.status).toBe("purged");
  expect(f.job.ownPatientIds).toBeNull();
  expect(f.audits()).toStrictEqual(original);
  expect(exportJobsOf(f.db)).toContain(f.job);
});

it("widening branch scope freezes A/B and never includes C rows", async () => {
  const f = fixture();
  for (const [index, branch] of [f.a, f.b, f.c].entries()) {
    const inv = invoice(f, index + 1, { branchId: branch.id });
    payment(f, index + 1, inv);
  }
  const persona = personaWith(
    ["view:report_takings:branch", "view:payments:branch"],
    [f.a.id, f.b.id],
  );
  admitReportExport(
    f.db,
    persona,
    {
      report: "daily_takings",
      format: "csv",
      language: "en",
      from: "2026-01-01",
      to: "2026-12-31",
    },
    NOW,
  );
  const job = exportJobsOf(f.db)[0];
  const member = f.db.members.find((m) => m.id === persona.memberId);
  const role = f.db.roles.find((r) => r.id === member?.roleId);
  if (!job || !role) throw new Error("Missing job/role");
  role.permissions = ["view:report_takings:clinic", "view:payments:clinic"];
  await advanceReportExport(f.db, job, () => new Date(NOW.getTime() + EXPORT_STEP_MS));
  await advanceReportExport(f.db, job, () => new Date(NOW.getTime() + 2 * EXPORT_STEP_MS));
  expect(job.status).toBe("done");
  expect(job.params.branchIds).toStrictEqual([f.a.id, f.b.id]);
  expect(job.rowCount).toBe(2);
  const body = new TextDecoder().decode(job.artifact ?? new Uint8Array());
  expect(body).toContain("Branch A");
  expect(body).toContain("Branch B");
  expect(body).not.toContain("Branch C");
});
