import { beforeEach, describe, expect, it, vi } from "vitest";
import { isBirthDateValid, todayInTimeZone, type PatientInput } from "@contracts/patients";
import { clinicDetailsInputSchema } from "@contracts/clinics";
import type { Persona } from "@contracts/session";

vi.mock("@/shared/api/mock/mock-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/shared/api/mock/mock-store")>();
  return { ...real, delay: async () => undefined };
});

const { createMockApiClient } = await import("@/shared/api/mock/mock-adapter");
const { getState, resetMockData } = await import("@/shared/api/mock/mock-store");

const api = createMockApiClient();

function clinicId() {
  const clinic = getState().clinics[0];
  if (!clinic) throw new Error("no clinic");
  return clinic.id;
}
const as = (kind: Persona["kind"]): Persona => ({ kind, clinicId: clinicId(), memberId: null });
function memberOf(kind: string) {
  const db = getState();
  const role = db.roles.find((r) => r.clinicId === clinicId() && r.systemKey === kind);
  const m = db.members.find((x) => x.roleId === role?.id && x.status === "active");
  if (!m) throw new Error(kind);
  return m;
}
function branches() {
  return getState().branches.filter((b) => b.clinicId === clinicId());
}
function otherBranchThan(ids: readonly string[]) {
  const b = branches().find((x) => !ids.includes(x.id));
  if (!b) throw new Error("no other branch");
  return b;
}
function input(branchId: string, phone = "55501234"): PatientInput {
  return {
    fullName: "مراجع تجريبي",
    phone,
    birthDate: "1990-04-01",
    gender: "male",
    registrationBranchId: branchId,
    civilId: "290040112345",
  };
}
const ALL = { cursor: null, limit: 100, q: "", branchId: null, status: null };

describe("patients mock", () => {
  beforeEach(() => resetMockData());

  it("hides other branches' patients from branch-scoped users (not_found)", async () => {
    const own = memberOf("receptionist").branchIds;
    const list = await api.patients.list(as("receptionist"), ALL);
    expect(list.items.length).toBeGreaterThan(0);
    expect(list.items.every((p) => own.includes(p.registrationBranchId))).toBe(true);
    const foreign = getState().patients.find(
      (p) => p.clinicId === clinicId() && !own.includes(p.registrationBranchId),
    );
    if (!foreign) throw new Error("no foreign patient");
    await expect(api.patients.open(as("receptionist"), foreign.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      api.patients.update(as("receptionist"), foreign.id, input(own[0] ?? "", "55509999")),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects a branch-scoped create outside the user's branches", async () => {
    const outside = otherBranchThan(memberOf("receptionist").branchIds);
    await expect(
      api.patients.create(as("receptionist"), input(outside.id), crypto.randomUUID()),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("gives clinic scope every branch", async () => {
    const list = await api.patients.list(as("clinic_admin"), ALL);
    expect(list.total).toBe(getState().patients.filter((p) => p.clinicId === clinicId()).length);
    expect(new Set(list.items.map((p) => p.registrationBranchId)).size).toBe(2);
  });

  it("rejects every call while the module is off, even for an admin", async () => {
    const patient = getState().patients.find((p) => p.clinicId === clinicId());
    if (!patient) throw new Error("no patient");
    const branch = branches()[0];
    if (!branch) throw new Error("no branch");
    getState().features[clinicId()] = { patients: false };
    const admin = as("clinic_admin");
    for (const call of [
      api.patients.list(admin, ALL),
      api.patients.branchOptions(admin, "view"),
      api.patients.open(admin, patient.id),
      api.patients.create(admin, input(branch.id), crypto.randomUUID()),
      api.patients.update(admin, patient.id, input(branch.id)),
      api.patients.archive(admin, patient.id),
      api.patients.restore(admin, patient.id),
    ]) {
      await expect(call).rejects.toMatchObject({ code: "module_disabled" });
    }
  });

  it("rejects duplicate phones written in different forms", async () => {
    const branch = branches()[0];
    if (!branch) throw new Error("no branch");
    const created = await api.patients.create(
      as("clinic_admin"),
      input(branch.id, "5550 1234"),
      crypto.randomUUID(),
    );
    expect(created.detail?.phone).toBe("+96555501234");
    for (const spelling of ["55501234", "+965 5550-1234", "0096555501234"]) {
      await expect(
        api.patients.create(as("clinic_admin"), input(branch.id, spelling), crypto.randomUUID()),
      ).rejects.toMatchObject({
        code: "patient_phone_taken",
        details: { patientId: created.id, fileNumber: created.fileNumber },
      });
    }
  });

  it("assigns sequential file numbers and never reuses archived ones", async () => {
    const branch = branches()[0];
    if (!branch) throw new Error("no branch");
    const start = getState().patientCounters[clinicId()] ?? 0;
    const a = await api.patients.create(
      as("clinic_admin"),
      input(branch.id, "55500001"),
      crypto.randomUUID(),
    );
    await api.patients.archive(as("clinic_admin"), a.id);
    const b = await api.patients.create(
      as("clinic_admin"),
      input(branch.id, "55500002"),
      crypto.randomUUID(),
    );
    expect(a.fileNumber).toBe(start + 1);
    expect(b.fileNumber).toBe(start + 2);
  });

  it("audits opening a file as patient access", async () => {
    const patient = getState().patients.find((p) => p.clinicId === clinicId());
    if (!patient) throw new Error("no patient");
    await api.patients.list(as("clinic_admin"), ALL);
    expect(getState().clinicAudit).toHaveLength(0);
    await api.patients.open(as("clinic_admin"), patient.id);
    expect(getState().clinicAudit[0]).toMatchObject({
      action: "patient.opened",
      entity: "patient",
      category: "patient_access",
      entityId: patient.id,
    });
  });

  it("never writes civilId into any audit entry", async () => {
    const branch = branches()[0];
    if (!branch) throw new Error("no branch");
    const admin = as("clinic_admin");
    const p = await api.patients.create(admin, input(branch.id), crypto.randomUUID());
    await api.patients.update(admin, p.id, { ...input(branch.id), civilId: "299999999999" });
    await api.patients.open(admin, p.id);
    await api.patients.archive(admin, p.id);
    await api.patients.restore(admin, p.id);
    const text = JSON.stringify(getState().clinicAudit);
    expect(getState().clinicAudit.length).toBe(5);
    expect(text).not.toContain("civilId");
    expect(text).not.toContain("290040112345");
    expect(text).not.toContain("299999999999");
  });

  it("rejects a view-only Doctor on create, update and archive", async () => {
    const doctor = as("doctor");
    const own = memberOf("doctor").branchIds[0] ?? "";
    const patient = getState().patients.find((p) => p.registrationBranchId === own);
    if (!patient) throw new Error("no patient");
    await expect(api.patients.open(doctor, patient.id)).resolves.toMatchObject({
      id: patient.id,
    });
    await expect(
      api.patients.create(doctor, input(own), crypto.randomUUID()),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(api.patients.update(doctor, patient.id, input(own))).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(api.patients.archive(doctor, patient.id)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("leaks nothing about a duplicate outside the caller's scope", async () => {
    const own = memberOf("receptionist").branchIds;
    const foreign = getState().patients.find(
      (p) => p.clinicId === clinicId() && !own.includes(p.registrationBranchId),
    );
    if (!foreign) throw new Error("no foreign patient");
    const error = await api.patients
      .create(as("receptionist"), input(own[0] ?? "", foreign.phone), crypto.randomUUID())
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "patient_phone_taken", details: {} });
  });

  it("keeps patient data out of the platform clinic detail", async () => {
    const detail = await api.platform.getClinic(clinicId());
    const text = JSON.stringify(detail);
    for (const p of getState().patients.filter((x) => x.clinicId === clinicId())) {
      expect(text).not.toContain(p.fullName);
      expect(text).not.toContain(p.phone);
    }
    expect(Object.keys(detail).filter((k) => /patient/i.test(k))).toEqual([]);
    expect(Object.keys(api.platform).filter((k) => /patient/i.test(k))).toEqual([]);
  });
  it("checks access before validating the request", async () => {
    const bad = { ...ALL, limit: -1 };
    getState().features[clinicId()] = { patients: false };
    await expect(api.patients.list(as("doctor"), bad)).rejects.toMatchObject({
      code: "module_disabled",
    });
    getState().features[clinicId()] = { patients: true };
    await expect(
      api.patients.create(
        as("doctor"),
        { ...input(branches()[0]!.id), phone: "x" },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("offers form branches from the create scope, not the view scope", async () => {
    const db = getState();
    const member = memberOf("receptionist");
    const role = db.roles.find((r) => r.id === member.roleId);
    if (!role) throw new Error("role");
    role.permissions = ["view:patients:clinic", "create:patients:branch"];
    const persona = as("receptionist");
    const view = await api.patients.branchOptions(persona, "view");
    const create = await api.patients.branchOptions(persona, "create");
    expect(view.length).toBe(branches().length);
    expect(create.map((b) => b.id).sort()).toEqual([...member.branchIds].sort());
    expect(create.length).toBeLessThan(view.length);
  });
  it("judges birth dates by the clinic's calendar, not UTC", async () => {
    // 01:30 in Kuwait on 15 March is still 14 March in UTC.
    const now = new Date("2026-03-14T22:30:00Z");
    expect(todayInTimeZone("Asia/Kuwait", now)).toBe("2026-03-15");
    expect(isBirthDateValid("2026-03-15", todayInTimeZone("Asia/Kuwait", now))).toBe(true);
    expect(isBirthDateValid("2026-03-16", todayInTimeZone("Asia/Kuwait", now))).toBe(false);
    expect(isBirthDateValid("2026-02-30", "2026-03-15")).toBe(false);
  });

  it("checks the account and module before the branch-options action", async () => {
    getState().features[clinicId()] = { patients: false };
    await expect(
      api.patients.branchOptions(as("doctor"), "nope" as unknown as "view"),
    ).rejects.toMatchObject({ code: "module_disabled" });
  });
  it("replays a retried create with the same key and refuses a changed request", async () => {
    const branch = branches()[0]!;
    const admin = as("clinic_admin");
    const key = crypto.randomUUID();
    const first = await api.patients.create(admin, input(branch.id, "55507777"), key);
    const retry = await api.patients.create(admin, input(branch.id, "55507777"), key);
    expect(retry.id).toBe(first.id);
    expect(getState().patients.filter((p) => p.phone === "+96555507777")).toHaveLength(1);
    await expect(
      api.patients.create(admin, input(branch.id, "55508888"), key),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
  });
  it("reports per-record actions from each action's own scope", async () => {
    const db = getState();
    const member = memberOf("receptionist");
    const role = db.roles.find((r) => r.id === member.roleId);
    if (!role) throw new Error("role");
    role.permissions = ["view:patients:clinic", "update:patients:branch"];
    const list = await api.patients.list(as("receptionist"), ALL);
    const own = list.items.find((p) => member.branchIds.includes(p.registrationBranchId));
    const foreign = list.items.find((p) => !member.branchIds.includes(p.registrationBranchId));
    if (!own || !foreign) throw new Error("seed");
    expect(own.actions).toEqual({ update: true, deactivate: false });
    expect(foreign.actions).toEqual({ update: false, deactivate: false });
    expect((await api.patients.open(as("receptionist"), foreign.id)).actions.update).toBe(false);
  });
  it("does not replay a create whose file left the caller's scope", async () => {
    const member = memberOf("receptionist");
    const own = member.branchIds[0];
    if (!own || member.branchIds.length < 1) throw new Error("seed");
    const key = crypto.randomUUID();
    const persona = as("receptionist");
    await api.patients.create(persona, input(own, "55506666"), key);
    member.branchIds = branches()
      .map((b) => b.id)
      .filter((id) => id !== own);
    await expect(api.patients.create(persona, input(own, "55506666"), key)).rejects.toMatchObject({
      code: expect.stringMatching(/not_found|forbidden/),
    });
  });
  it("returns no file when a write moves it out of the caller's view", async () => {
    const db = getState();
    const member = memberOf("receptionist");
    const role = db.roles.find((r) => r.id === member.roleId);
    if (!role) throw new Error("role");
    role.permissions = ["view:patients:branch", "update:patients:clinic"];
    const persona = as("receptionist");
    const list = await api.patients.list(persona, ALL);
    const mine = list.items[0];
    if (!mine) throw new Error("seed");
    const outside = otherBranchThan(member.branchIds);
    const detail = await api.patients.open(persona, mine.id);
    const result = await api.patients.update(persona, mine.id, {
      ...input(outside.id, detail.phone),
      civilId: detail.civilId ?? "",
    });
    expect(result.detail).toBeNull();
    expect(JSON.stringify(result)).not.toContain(detail.phone);
  });

  it("replays a create for a create-only role without exposing the file", async () => {
    const db = getState();
    const member = memberOf("receptionist");
    const role = db.roles.find((r) => r.id === member.roleId);
    if (!role) throw new Error("role");
    role.permissions = ["create:patients:branch"];
    const persona = as("receptionist");
    const own = member.branchIds[0] ?? "";
    const key = crypto.randomUUID();
    const first = await api.patients.create(persona, input(own, "55504444"), key);
    const retry = await api.patients.create(persona, input(own, "55504444"), key);
    expect(retry).toEqual(first);
    expect(retry.detail).toBeNull();
  });
  it("accepts only supported clinic time zones", () => {
    const zone = (timezone: string) =>
      clinicDetailsInputSchema.shape.timezone.safeParse(timezone).success;
    expect(zone("Asia/Kuwait")).toBe(true);
    expect(zone("Mars/Olympus")).toBe(false);
  });
});
