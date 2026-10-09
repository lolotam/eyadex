import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Persona } from "@eyadex/contracts/session";

vi.mock("@/shared/api/mock/mock-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/shared/api/mock/mock-store")>();
  return { ...real, delay: async () => undefined };
});

const { createMockApiClient } = await import("@/shared/api/mock/mock-adapter");
const { getState, resetMockData } = await import("@/shared/api/mock/mock-store");

const api = createMockApiClient();
// A fresh Idempotency-Key per call: each create below is a new request.
const createRole = (persona: Persona, input: Parameters<typeof api.roles.create>[1]) =>
  api.roles.create(persona, input, crypto.randomUUID());

function clinicId() {
  const clinic = getState().clinics[0];
  if (!clinic) throw new Error("no clinic");
  return clinic.id;
}
function admin(id = clinicId()): Persona {
  return { kind: "clinic_admin", clinicId: id, memberId: null };
}
function role(key: string, id = clinicId()) {
  const found = getState().roles.find((r) => r.clinicId === id && r.systemKey === key);
  if (!found) throw new Error(key);
  return found;
}
async function rejectsWith(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}
const NAMES = { nameAr: "مشرف", nameEn: "Supervisor" };

describe("roles mock", () => {
  beforeEach(() => resetMockData());

  it("rejects rename, permission edit and deactivate of the locked admin role", async () => {
    const locked = role("clinic_admin");
    await rejectsWith(
      api.roles.update(admin(), locked.id, { ...NAMES, permissionKeys: locked.permissions }),
      "role_locked",
    );
    await rejectsWith(
      api.roles.update(admin(), locked.id, {
        nameAr: locked.nameAr,
        nameEn: locked.nameEn,
        permissionKeys: [],
      }),
      "role_locked",
    );
    await rejectsWith(api.roles.deactivate(admin(), locked.id), "role_locked");
  });

  it("blocks deactivating a role with members, allows it without, and reactivates", async () => {
    const doctor = role("doctor");
    const holders = getState().members.filter(
      (m) => m.roleId === doctor.id && m.status === "active",
    ).length;
    expect(holders).toBeGreaterThan(0);
    await expect(api.roles.deactivate(admin(), doctor.id)).rejects.toMatchObject({
      code: "role_in_use",
      details: { count: holders },
    });
    const created = await createRole(admin(), { ...NAMES, permissionKeys: [] });
    expect((await api.roles.deactivate(admin(), created.id)).isActive).toBe(false);
    expect((await api.roles.reactivate(admin(), created.id)).isActive).toBe(true);
  });

  it("rejects duplicate names, case-insensitive", async () => {
    await rejectsWith(
      createRole(admin(), { nameAr: "جديد", nameEn: "doctor", permissionKeys: [] }),
      "role_name_taken",
    );
  });

  it("rejects an unknown permission key and two scopes for one action", async () => {
    await rejectsWith(
      createRole(admin(), { ...NAMES, permissionKeys: ["delete:everything:clinic"] }),
      "validation",
    );
    await rejectsWith(
      createRole(admin(), {
        ...NAMES,
        permissionKeys: ["view:patients:clinic", "view:patients:branch"],
      }),
      "validation",
    );
  });

  it("keeps hidden patients keys when saving while the module is off", async () => {
    const id = clinicId();
    getState().features[id] = { patients: false, appointments: false };
    const receptionist = role("receptionist");
    const before = receptionist.permissions.filter((k) => k.includes(":patients:"));
    expect(before.length).toBeGreaterThan(0);
    const catalog = await api.roles.catalog(admin());
    expect(catalog.some((d) => d.resource === "patients")).toBe(false);
    const saved = await api.roles.update(admin(), receptionist.id, {
      nameAr: receptionist.nameAr,
      nameEn: receptionist.nameEn,
      permissionKeys: ["view:branches:clinic"],
    });
    expect(saved.permissionKeys).toEqual(
      expect.arrayContaining([...before, "view:branches:clinic"]),
    );
  });

  it("applies a permission change to a holder immediately", async () => {
    const doctor = role("doctor");
    const doctorPersona: Persona = { kind: "doctor", clinicId: clinicId(), memberId: null };
    expect((await api.session.getContext(doctorPersona)).permissions).not.toContain(
      "view:branches:clinic",
    );
    await api.roles.update(admin(), doctor.id, {
      nameAr: doctor.nameAr,
      nameEn: doctor.nameEn,
      permissionKeys: [...doctor.permissions, "view:branches:clinic"],
    });
    expect((await api.session.getContext(doctorPersona)).permissions).toContain(
      "view:branches:clinic",
    );
  });

  it("writes an administrative audit entry with names and keys", async () => {
    const created = await createRole(admin(), {
      ...NAMES,
      permissionKeys: ["view:users:clinic"],
    });
    const entry = getState().clinicAudit.find((e) => e.entityId === created.id);
    expect(entry).toMatchObject({
      entity: "role",
      category: "administrative",
      action: "role.created",
      after: { nameAr: "مشرف", nameEn: "Supervisor", permissionKeys: ["view:users:clinic"] },
    });
  });

  it("rejects every write for a persona without roles permissions", async () => {
    const doctor: Persona = { kind: "doctor", clinicId: clinicId(), memberId: null };
    const target = role("technician");
    const input = { ...NAMES, permissionKeys: [] };
    await rejectsWith(api.roles.list(doctor), "forbidden");
    await rejectsWith(createRole(doctor, input), "forbidden");
    await rejectsWith(api.roles.update(doctor, target.id, input), "forbidden");
    await rejectsWith(api.roles.deactivate(doctor, target.id), "forbidden");
    await rejectsWith(api.roles.reactivate(doctor, target.id), "forbidden");
  });
  it("defines only the PRD actions for audit log and clinic settings", async () => {
    const keys = (await api.roles.catalog(admin())).map((d) => d.key);
    expect(keys.filter((k) => k.includes(":audit_log:"))).toEqual(["view:audit_log:clinic"]);
    expect(keys.filter((k) => k.includes(":clinic_settings:")).sort()).toEqual([
      "update:clinic_settings:clinic",
      "view:clinic_settings:clinic",
    ]);
    await rejectsWith(
      createRole(admin(), { ...NAMES, permissionKeys: ["deactivate:audit_log:clinic"] }),
      "validation",
    );
  });

  it("counts deactivated holders, so their role cannot be deactivated under them", async () => {
    const created = await createRole(admin(), { ...NAMES, permissionKeys: [] });
    const db = getState();
    const adminRoleId = role("clinic_admin").id;
    const holder = db.members.find(
      (m) => m.clinicId === clinicId() && m.status === "active" && m.roleId !== adminRoleId,
    );
    if (!holder) throw new Error("no member");
    holder.roleId = created.id;
    holder.status = "deactivated";
    expect((await api.roles.list(admin())).find((r) => r.id === created.id)?.memberCount).toBe(1);
    await rejectsWith(api.roles.deactivate(admin(), created.id), "role_in_use");
  });
  it("rejects a write permission without view on the same resource", async () => {
    await rejectsWith(
      createRole(admin(), { ...NAMES, permissionKeys: ["create:patients:branch"] }),
      "validation",
    );
    const ok = await createRole(admin(), {
      ...NAMES,
      permissionKeys: ["view:patients:clinic", "create:patients:branch"],
    });
    expect(ok.permissionKeys).toContain("create:patients:branch");
  });
});
