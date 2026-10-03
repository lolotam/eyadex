import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/api/mock/mock-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/shared/api/mock/mock-store")>();
  return { ...real, delay: async () => undefined };
});

const { getState, resetMockData } = await import("@/shared/api/mock/mock-store");
const { ALL, api, as, branches, clinicId, input, memberOf, otherBranchThan } =
  await import("./patients-test-kit");

describe("patients mock: access and scope", () => {
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
    // Indistinguishable from any other invalid input: no hidden file is confirmed.
    expect(error).toMatchObject({ code: "validation" });
    expect(JSON.stringify(error)).not.toContain(foreign.id);
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

  it("checks the account and module before the branch-options action", async () => {
    getState().features[clinicId()] = { patients: false };
    await expect(
      api.patients.branchOptions(as("doctor"), "nope" as unknown as "view"),
    ).rejects.toMatchObject({ code: "module_disabled" });
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
});
