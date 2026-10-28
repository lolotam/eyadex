import { expect, it } from "vitest";
import { admitReportExport } from "./mock-report-export-admission";
import { exportJobsOf } from "./mock-report-export-state";
import { advanceReportExport, EXPORT_STEP_MS, EXPORT_LIFETIME_MS } from "./mock-report-export-run";
import { fixture, invoice, payment, makeOwn, NOW } from "./mock-report-export.test-kit";
import { personaWith } from "./mock-report-test-kit";

function setup(own = false) {
  const f = fixture();
  f.db.appointments = [];
  f.db.medical.visits = [];
  const keys = own ? ["view:report_own:own", "view:invoices:own"]
    : ["view:report_takings:branch", "view:payments:branch"];
  const persona = personaWith(keys, [f.a.id, f.b.id]);
  const member = f.db.members.find((m) => m.id === persona.memberId);
  const role = f.db.roles.find((r) => r.id === member?.roleId);
  if (!member || !role) throw new Error("Missing custom actor");
  // The shared fixture adds an actual appointment; its provider must be this requester.
  makeOwn(f, f.patient.id);
  const appointment = f.db.appointments.at(-1);
  if (!appointment) throw new Error("Missing own appointment");
  appointment.providerMembershipId = member.id;
  const inv = invoice(f, 1);
  payment(f, 1, inv);
  admitReportExport(f.db, persona, {
    report: own ? "own_summary" : "daily_takings", format: "xlsx", language: "en",
    from: "2026-01-01", to: "2026-12-31",
  }, NOW);
  const job = exportJobsOf(f.db)[0];
  if (!job) throw new Error("Missing job");
  const baseline = structuredClone(f.db.clinicAudit);
  let time = NOW.getTime();
  const clock = () => new Date(time);
  const advance = () => advanceReportExport(f.db, job, clock);
  const tick = (ms = EXPORT_STEP_MS) => { time += ms; };
  const failed = async () => {
    expect(job.status).toBe("failed");
    expect(job.artifact).toBeNull();
    expect(job.ownPatientIds).toBeNull();
    expect(job.byteSize).toBeNull();
    expect(job.rowCount).toBeNull();
    expect(job.expiresAt).toBeNull();
    expect(job).not.toHaveProperty("error");
    expect(f.db.clinicAudit).toStrictEqual(baseline);
    expect(exportJobsOf(f.db)).toContain(job);
    tick(EXPORT_LIFETIME_MS);
    await advance();
    expect(job.status).toBe("failed");
    expect(f.db.clinicAudit).toStrictEqual(baseline);
  };
  return { ...f, job, member, role, inv, appointment, advance, tick, failed, clock };
}

type RunFixture = ReturnType<typeof setup>;
const revoke: Record<string, (f: RunFixture) => void> = {
  "report permission": (f) => { f.role.permissions = ["view:payments:branch"]; },
  "covering permission": (f) => { f.role.permissions = ["view:report_takings:branch"]; },
  "one frozen branch": (f) => { f.member.branchIds = [f.a.id]; },
  "removed frozen branch": (f) => { f.db.branches = f.db.branches.filter((b) => b.id !== f.b.id); },
  "inactive account": (f) => { f.member.status = "inactive"; },
  "inactive role": (f) => { f.role.isActive = false; },
  "missing role": (f) => { f.db.roles = f.db.roles.filter((r) => r.id !== f.role.id); },
  "suspended clinic": (f) => { const clinic = f.db.clinics.find((c) => c.id === f.ctx.clinicId); if (!clinic) throw new Error("clinic"); clinic.status = "suspended"; },
  "expired clinic": (f) => { const clinic = f.db.clinics.find((c) => c.id === f.ctx.clinicId); if (!clinic) throw new Error("clinic"); clinic.expiresAt = NOW.toISOString(); },
  "disabled module": (f) => { const features = f.db.features[f.ctx.clinicId]; if (!features) throw new Error("features"); features.finance = false; },
};

it.each(Object.keys(revoke))("queued revocation of %s fails before the reader, with no audit", async (key) => {
  const f = setup();
  // If claim accidentally reads, this accessor would throw before the access helper is reached.
  let reads = 0;
  Object.defineProperty(f.inv, "totalMinor", { get() { reads += 1; return "9000"; } });
  revoke[key]?.(f);
  f.tick();
  await f.advance();
  expect(reads).toBe(0);
  await f.failed();
});

it.each(Object.keys(revoke))("post-write live guard catches %s lost DURING real asynchronous ZIP writing", async (key) => {
  const f = setup();
  f.tick();
  await f.advance();
  expect(f.job.status).toBe("running");
  f.tick();
  const work = f.advance();
  expect(f.job.status).toBe("running");
  expect(f.job.artifact).toBeNull();
  revoke[key]?.(f);
  await work;
  await f.failed();
});

it("scope narrowing from clinic to branch during writing fails the entire job", async () => {
  const f = setup();
  f.role.permissions = ["view:report_takings:clinic", "view:payments:clinic"];
  admitReportExport(f.db, { kind: "custom", clinicId: f.ctx.clinicId, memberId: f.member.id }, {
    report: "daily_takings", format: "xlsx", language: "en", from: "2026-01-01", to: "2026-12-31",
  }, NOW);
  const job = exportJobsOf(f.db)[1];
  if (!job) throw new Error("Missing clinic-scoped job");
  await advanceReportExport(f.db, job, () => new Date(NOW.getTime() + EXPORT_STEP_MS));
  const work = advanceReportExport(f.db, job, () => new Date(NOW.getTime() + 2 * EXPORT_STEP_MS));
  f.role.permissions = ["view:report_takings:branch", "view:payments:branch"];
  await work;
  expect(job.status).toBe("failed");
  expect(job.artifact).toBeNull();
  expect(job.ownPatientIds).toBeNull();
  expect(f.db.clinicAudit.filter((r) => r.entityId === job.id)).toHaveLength(0);
});

it.each(["permission", "own reach"])("post-write own guard catches %s loss during genuine ZIP writing", async (kind) => {
  const f = setup(true);
  f.tick();
  await f.advance();
  f.tick();
  const work = f.advance();
  if (kind === "permission") f.role.permissions = ["view:report_own:own", "view:invoices:clinic"];
  else f.appointment.status = "cancelled";
  await work;
  await f.failed();
});

it("CSV common await boundary also rechecks live access", async () => {
  const f = setup();
  admitReportExport(f.db, { kind: "custom", clinicId: f.ctx.clinicId, memberId: f.member.id }, {
    report: "daily_takings", format: "csv", language: "en", from: "2026-01-01", to: "2026-12-31",
  }, NOW);
  const job = exportJobsOf(f.db)[1];
  if (!job) throw new Error("Missing CSV job");
  await advanceReportExport(f.db, job, () => new Date(NOW.getTime() + EXPORT_STEP_MS));
  const work = advanceReportExport(f.db, job, () => new Date(NOW.getTime() + 2 * EXPORT_STEP_MS));
  f.member.status = "inactive";
  await work;
  expect(job.status).toBe("failed");
  expect(job.artifact).toBeNull();
  expect(f.db.clinicAudit.filter((r) => r.entityId === job.id)).toHaveLength(0);
});

it.each(["precision", "invalid XML", "invalid row"])("actual %s refusal keeps a failed job without bytes or success audit", async (kind) => {
  const f = setup();
  if (kind === "precision") {
    // Use the real CSV writer, not a mocked refusal.
    admitReportExport(f.db, { kind: "custom", clinicId: f.ctx.clinicId, memberId: f.member.id }, {
      report: "daily_takings", format: "csv", language: "en", from: "2026-01-01", to: "2026-12-31",
    }, NOW);
    const payment = (await import("./mock-payment-state")).paymentState(f.db).payments[0];
    if (!payment) throw new Error("Missing payment");
    payment.amountMinor = "1234567890123456";
    const job = exportJobsOf(f.db)[1];
    if (!job) throw new Error("Missing CSV job");
    await advanceReportExport(f.db, job, () => new Date(NOW.getTime() + EXPORT_STEP_MS));
    await advanceReportExport(f.db, job, () => new Date(NOW.getTime() + 2 * EXPORT_STEP_MS));
    expect(job.status).toBe("failed");
    expect(job.artifact).toBeNull();
    expect(job.ownPatientIds).toBeNull();
    expect(f.db.clinicAudit.filter((r) => r.entityId === job.id)).toHaveLength(0);
  } else {
    if (kind === "invalid XML") f.a.nameEn = "synthetic-private-marker\u0000";
    else Object.defineProperty(f.a, "nameEn", { value: 42 });
    f.tick(); await f.advance(); f.tick(); await f.advance();
    await f.failed();
  }
});

it("publication performs a separate immediate live check after the post-write check", async () => {
  const f = setup();
  f.tick(); await f.advance(); f.tick();
  let calls = 0;
  await advanceReportExport(f.db, f.job, () => {
    calls += 1;
    // call 1 scheduling, 2 read, 3 post-write, 4 immediately before publication.
    if (calls === 4) f.role.isActive = false;
    return f.clock();
  });
  expect(calls).toBe(4);
  await f.failed();
});