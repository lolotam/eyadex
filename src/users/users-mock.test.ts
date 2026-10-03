import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Persona } from "@contracts/session";

vi.mock("@/shared/api/mock/mock-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/shared/api/mock/mock-store")>();
  return { ...real, delay: async () => undefined };
});

const { createMockApiClient } = await import("@/shared/api/mock/mock-adapter");
const { getState, resetMockData } = await import("@/shared/api/mock/mock-store");

const DAY = 86_400_000;
const api = createMockApiClient();

function clinicBySlug(slug: string) {
  const clinic = getState().clinics.find((c) => c.slug === slug);
  if (!clinic) throw new Error(slug);
  return clinic;
}
function admin(clinicId: string): Persona {
  return { kind: "clinic_admin", clinicId, memberId: null };
}
function roleId(clinicId: string, key: string) {
  const role = getState().roles.find((r) => r.clinicId === clinicId && r.systemKey === key);
  if (!role) throw new Error(key);
  return role.id;
}
function invite(clinicId: string, email: string, persona = admin(clinicId)) {
  return api.invitations.invite(persona, {
    fullName: "Test Person",
    email,
    roleId: roleId(clinicId, "doctor"),
    allBranches: true,
    branchIds: [],
  });
}
const password = { password: "secret-123", confirmPassword: "secret-123" };

beforeEach(() => resetMockData());

describe("users mock", () => {
  it("protects the last active clinic admin from deactivation and role change", async () => {
    const clinic = clinicBySlug("serenity");
    const adminMember = getState().members.find(
      (m) => m.clinicId === clinic.id && m.roleId === roleId(clinic.id, "clinic_admin"),
    );
    if (!adminMember) throw new Error("no admin");
    await expect(api.users.deactivate(admin(clinic.id), adminMember.id)).rejects.toMatchObject({
      code: "last_active_admin",
    });
    await expect(
      api.users.changeRole(admin(clinic.id), adminMember.id, {
        roleId: roleId(clinic.id, "doctor"),
      }),
    ).rejects.toMatchObject({ code: "last_active_admin" });
  });

  it("blocks a deactivated user on their next request", async () => {
    const clinic = clinicBySlug("serenity");
    const doctor = getState().members.find(
      (m) => m.clinicId === clinic.id && m.roleId === roleId(clinic.id, "doctor"),
    );
    if (!doctor) throw new Error("no doctor");
    const doctorPersona: Persona = { kind: "doctor", clinicId: clinic.id, memberId: doctor.id };
    await expect(api.session.getContext(doctorPersona)).resolves.toBeTruthy();
    await api.users.deactivate(admin(clinic.id), doctor.id);
    await expect(api.session.getContext(doctorPersona)).rejects.toMatchObject({
      code: "account_disabled",
    });
  });

  it("gives a Doctor a permission error on inviteUser", async () => {
    const clinic = clinicBySlug("serenity");
    const doctorPersona: Persona = { kind: "doctor", clinicId: clinic.id, memberId: null };
    await expect(invite(clinic.id, "x@example.com", doctorPersona)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("lists custom-role accounts for sign-in and lets them sign in", async () => {
    const clinic = clinicBySlug("serenity");
    const base = getState().roles.find((r) => r.id === roleId(clinic.id, "doctor"));
    if (!base) throw new Error("no role");
    const custom = {
      ...base,
      id: crypto.randomUUID(),
      systemKey: null,
      nameAr: "مشرف",
      nameEn: "Supervisor",
    };
    getState().roles.push(custom as typeof base);
    const member = getState().members.find(
      (m) => m.clinicId === clinic.id && m.status === "active",
    );
    if (!member) throw new Error("no member");
    member.roleId = custom.id;
    const accounts = await api.session.listLoginAccounts(clinic.id);
    const row = accounts.find((a) => a.memberId === member.id);
    expect(row).toMatchObject({ roleKey: null, roleNameEn: "Supervisor", roleNameAr: "مشرف" });
    const ctx = await api.session.getContext({
      kind: "custom",
      clinicId: clinic.id,
      memberId: member.id,
    });
    expect(ctx.user.email).toBe(member.email);
  });

  it("refuses to reactivate a user whose only branch was deactivated, until it is repaired", async () => {
    const db = getState();
    const member = db.members.find(
      (m) => m.status === "active" && !m.allBranches && m.branchIds.length > 0,
    );
    if (!member) throw new Error("seed: no branch-scoped member");
    const persona = admin(member.clinicId);
    const otherBranch = db.branches.find(
      (b) => b.clinicId === member.clinicId && b.isActive && !member.branchIds.includes(b.id),
    );
    if (!otherBranch) throw new Error("seed: clinic needs a second active branch");
    await api.users.deactivate(persona, member.id);
    for (const b of db.branches) if (member.branchIds.includes(b.id)) b.isActive = false;
    await expect(api.users.reactivate(persona, member.id)).rejects.toMatchObject({
      code: "branch_inactive",
    });
    await api.users.changeBranches(persona, member.id, {
      allBranches: false,
      branchIds: [otherBranch.id],
    });
    await expect(api.users.reactivate(persona, member.id)).resolves.toMatchObject({
      status: "active",
    });
  });
});
