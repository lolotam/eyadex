import { beforeEach, expect, it } from "vitest";
import { NO_FEATURES } from "@eyadex/contracts/clinics";
import { admitReportExport } from "./mock-report-export-admission";
import { recheckExportAccess } from "./mock-report-export-access";
import { exportJobsOf, type ExportJobRecord } from "./mock-report-export-state";
import { buildSeed } from "./seed";
import { admin, clinicIdAt, getState, memberOf, personaWith } from "./mock-report-test-kit";
import { persist } from "./mock-store";
import { resetMockData } from "./mock-test-kit";

const NOW = new Date("2026-10-28T12:00:00.000Z");

const request = (changes: Record<string, unknown> = {}) => ({
  report: "daily_takings",
  from: "2026-01-01",
  to: "2026-12-31",
  format: "csv",
  language: "en",
  ...changes,
});

function admitted(changes: Record<string, unknown> = {}, persona = admin()): ExportJobRecord {
  admitReportExport(getState(), persona, request(changes), NOW);
  const job = exportJobsOf(getState()).at(-1);
  if (!job) throw new Error("missing job");
  return job;
}

const branchesOf = () => getState().branches.filter((b) => b.clinicId === clinicIdAt(0));

function adminRole() {
  const role = getState().roles.find((r) => r.id === memberOf("clinic_admin").roleId);
  if (!role) throw new Error("seed");
  return role;
}

beforeEach(() => resetMockData());

it("ready carries exactly the frozen branches and the request language", () => {
  const job = admitted({ language: "ar" });
  const outcome = recheckExportAccess(getState(), job, NOW);
  if (outcome.kind !== "ready") throw new Error("expected ready");
  expect(outcome.ctx.branchIds).toStrictEqual(job.params.branchIds);
  expect(outcome.ctx.language).toBe("ar");
  const [a] = branchesOf();
  if (!a) throw new Error("seed");
  expect(outcome.ctx.branchNames.get(a.id)).toBe(a.nameAr);
  expect(outcome.ctx.timeZone).toBe(getState().clinics[0]?.timezone);
});

it("a removed report key or covering key is forbidden", () => {
  const job = admitted();
  const second = admitted();
  const role = adminRole();
  const original = [...role.permissions];
  role.permissions = original.filter((key) => key !== "view:report_takings:clinic");
  expect(recheckExportAccess(getState(), job, NOW)).toStrictEqual({
    kind: "denied",
    code: "forbidden",
  });
  role.permissions = original.filter((key) => key !== "view:payments:clinic");
  expect(recheckExportAccess(getState(), second, NOW)).toStrictEqual({
    kind: "denied",
    code: "forbidden",
  });
});

it("late rechecks treat an inactive account or role as account_disabled before module access", () => {
  const job = admitted();
  const member = memberOf("clinic_admin");
  member.status = "deactivated";
  expect(recheckExportAccess(getState(), job, NOW)).toStrictEqual({
    kind: "denied",
    code: "account_disabled",
  });
  member.status = "active";
  adminRole().isActive = false;
  expect(recheckExportAccess(getState(), job, NOW)).toStrictEqual({
    kind: "denied",
    code: "account_disabled",
  });
  getState().features[clinicIdAt(0)] = { ...NO_FEATURES, finance: false };
  expect(recheckExportAccess(getState(), job, NOW)).toStrictEqual({
    kind: "denied",
    code: "account_disabled",
  });
});

it("finance off, suspension and the exact expiry boundary refuse with their own codes", () => {
  const job = admitted();
  const db = getState();
  const clinic = db.clinics.find((c) => c.id === clinicIdAt(0));
  if (!clinic) throw new Error("seed");
  db.features[clinic.id] = { ...(db.features[clinic.id] ?? NO_FEATURES), finance: false };
  expect(recheckExportAccess(db, job, NOW)).toStrictEqual({
    kind: "denied",
    code: "module_disabled",
  });
  db.features[clinic.id] = { ...(db.features[clinic.id] ?? NO_FEATURES), finance: true };
  clinic.status = "suspended";
  expect(recheckExportAccess(db, job, NOW)).toStrictEqual({
    kind: "denied",
    code: "subscription_blocked",
  });
  clinic.status = "active";
  clinic.expiresAt = NOW.toISOString();
  expect(recheckExportAccess(db, job, NOW)).toStrictEqual({
    kind: "denied",
    code: "subscription_blocked",
  });
  clinic.expiresAt = new Date(NOW.getTime() + 1).toISOString();
  expect(recheckExportAccess(db, job, NOW).kind).toBe("ready");
});

it("a scope narrowed from clinic to branch refuses the whole job as not_found", () => {
  const job = admitted();
  adminRole().permissions = ["view:report_takings:branch", "view:payments:branch"];
  expect(recheckExportAccess(getState(), job, NOW)).toStrictEqual({
    kind: "denied",
    code: "not_found",
  });
});

it("losing one frozen branch while keeping others refuses the whole job", () => {
  const job = admitted();
  const [, b] = branchesOf();
  if (!b) throw new Error("seed");
  getState().branches = getState().branches.filter((branch) => branch.id !== b.id);
  expect(recheckExportAccess(getState(), job, NOW)).toStrictEqual({
    kind: "denied",
    code: "not_found",
  });
});

it("a widened scope keeps exactly the frozen branches and adds none", () => {
  const [a, b] = branchesOf();
  if (!a || !b) throw new Error("seed");
  const keys = ["view:report_takings:branch", "view:payments:branch"];
  const persona = personaWith(keys, [a.id, b.id]);
  const job = admitted({}, persona);
  expect(job.scope).toBe("branch");
  expect(job.params.branchIds).toStrictEqual([a.id, b.id]);
  const role = getState().roles.find(
    (r) => r.id === getState().members.find((m) => m.id === persona.memberId)?.roleId,
  );
  if (!role) throw new Error("missing role");
  role.permissions = ["view:report_takings:clinic", "view:payments:clinic"];
  const outcome = recheckExportAccess(getState(), job, NOW);
  if (outcome.kind !== "ready") throw new Error("expected ready");
  expect(outcome.ctx.branchIds).toStrictEqual([a.id, b.id]);
});

it("an own job whose invoice key became branch or clinic scope is forbidden", () => {
  const doctor = memberOf("doctor");
  const job = admitted(
    { report: "own_summary" },
    { kind: "doctor", clinicId: clinicIdAt(0), memberId: null },
  );
  expect(job.scope).toBe("own");
  const role = getState().roles.find((r) => r.id === doctor.roleId);
  if (!role) throw new Error("seed");
  role.permissions = ["view:report_own:own", "view:invoices:clinic"];
  expect(recheckExportAccess(getState(), job, NOW)).toStrictEqual({
    kind: "denied",
    code: "forbidden",
  });
});

it("the reader context branches are a copy; mutating them never rewrites the job", () => {
  const job = admitted();
  const outcome = recheckExportAccess(getState(), job, NOW);
  if (outcome.kind !== "ready") throw new Error("expected ready");
  (outcome.ctx.branchIds as string[]).push("mutated");
  expect(job.params.branchIds).not.toContain("mutated");
});

it("two independent states never share jobs, and a foreign job is not_found there", () => {
  const first = buildSeed();
  const second = buildSeed();
  const clinic = first.clinics[0];
  if (!clinic) throw new Error("seed");
  admitReportExport(
    first,
    { kind: "clinic_admin", clinicId: clinic.id, memberId: null },
    request(),
    NOW,
  );
  expect(exportJobsOf(first)).toHaveLength(1);
  expect(exportJobsOf(second)).toHaveLength(0);
  const job = exportJobsOf(first)[0];
  if (!job) throw new Error("missing job");
  const foreign = { ...job, clinicId: "00000000-0000-4000-8000-000000000099" };
  expect(recheckExportAccess(second, foreign, NOW)).toStrictEqual({
    kind: "denied",
    code: "not_found",
  });
});

it("a reset state cannot see the old jobs", () => {
  admitted();
  expect(exportJobsOf(getState())).toHaveLength(1);
  resetMockData();
  expect(exportJobsOf(getState())).toHaveLength(0);
});

it("serialized state and browser storage carry no job, artifact or patient set", () => {
  const job = admitted();
  persist();
  const serialized = JSON.stringify(getState());
  const stored = window.localStorage.getItem("eyadex:mock-db:v22") ?? "";
  for (const text of [serialized, stored]) {
    expect(text).not.toContain(job.id);
    expect(text).not.toContain("ownPatientIds");
    expect(text).not.toContain("artifact");
  }
});
