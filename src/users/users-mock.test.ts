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

describe("users and invitations mock", () => {
  it("counts pending invitations against the limit but not expired or cancelled ones", async () => {
    const clinic = clinicBySlug("al-noor"); // seeded at exactly its limit
    expect(await api.users.usage(admin(clinic.id))).toEqual({ used: 6, limit: 6 });
    await expect(invite(clinic.id, "new@example.com")).rejects.toMatchObject({
      code: "limit_reached",
      details: { used: 6, limit: 6 },
    });

    const pending = getState().invitations.find(
      (i) => i.clinicId === clinic.id && new Date(i.expiresAt).getTime() > Date.now(),
    );
    if (!pending) throw new Error("no pending invitation");
    await api.invitations.cancel(admin(clinic.id), pending.id);
    expect((await api.users.usage(admin(clinic.id))).used).toBe(5);
    await invite(clinic.id, "new@example.com");
    expect((await api.users.usage(admin(clinic.id))).used).toBe(6);

    const fresh = getState().invitations.find((i) => i.email === "new@example.com");
    if (!fresh) throw new Error("missing");
    fresh.expiresAt = new Date(Date.now() - DAY).toISOString();
    expect((await api.users.usage(admin(clinic.id))).used).toBe(5);
  });

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

  it("rejects an email that already belongs to another clinic or the platform", async () => {
    const serenity = clinicBySlug("serenity");
    const other = getState().members.find((m) => m.clinicId !== serenity.id);
    if (!other) throw new Error("no member");
    await expect(invite(serenity.id, other.email)).rejects.toMatchObject({ code: "email_taken" });
    await expect(invite(serenity.id, "waleed@eyadex.com")).rejects.toMatchObject({
      code: "email_taken",
    });
    const pendingElsewhere = getState().invitations.find(
      (i) => i.clinicId !== serenity.id && new Date(i.expiresAt).getTime() > Date.now(),
    );
    if (!pendingElsewhere) throw new Error("no pending");
    await expect(invite(serenity.id, pendingElsewhere.email)).rejects.toMatchObject({
      code: "email_taken",
    });
  });

  it("rejects an expired invitation token and accepts a valid one once", async () => {
    const clinic = clinicBySlug("serenity");
    const expired = getState().invitations.find(
      (i) => i.clinicId === clinic.id && new Date(i.expiresAt).getTime() < Date.now(),
    );
    if (!expired) throw new Error("no expired");
    await expect(
      api.invitations.accept(getState().inviteOutbox[expired.id] ?? "", password),
    ).rejects.toMatchObject({
      code: "invitation_expired",
    });
    const sent = await invite(clinic.id, "joiner@example.com");
    const accepted = await api.invitations.accept(sent.token ?? "", password);
    expect(getState().members.some((m) => m.id === accepted.memberId)).toBe(true);
    await expect(api.invitations.accept(sent.token ?? "", password)).rejects.toMatchObject({
      code: "invitation_used",
    });
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

  it("rejects accepting when the invited role was deactivated after the invite", async () => {
    const clinic = clinicBySlug("serenity");
    const sent = await invite(clinic.id, "late-role@example.com");
    const role = getState().roles.find((r) => r.id === sent.roleId);
    if (!role) throw new Error("no role");
    role.isActive = false;
    await expect(api.invitations.accept(sent.token ?? "", password)).rejects.toMatchObject({
      code: "role_inactive",
    });
    const stored = getState().invitations.find((i) => i.id === sent.id);
    expect(stored?.status).toBe("pending");
    expect(getState().members.some((m) => m.email === "late-role@example.com")).toBe(false);
  });

  it("rejects accepting when an invited branch was deactivated after the invite", async () => {
    const clinic = clinicBySlug("serenity");
    const branch = getState().branches.find((b) => b.clinicId === clinic.id && b.isActive);
    if (!branch) throw new Error("no branch");
    const sent = await api.invitations.invite(admin(clinic.id), {
      fullName: "Branch Person",
      email: "late-branch@example.com",
      roleId: roleId(clinic.id, "doctor"),
      allBranches: false,
      branchIds: [branch.id],
    });
    branch.isActive = false;
    await expect(api.invitations.accept(sent.token ?? "", password)).rejects.toMatchObject({
      code: "branch_inactive",
    });
    expect(getState().invitations.find((i) => i.id === sent.id)?.status).toBe("pending");
  });

  it("keeps link tokens and their hashes out of every audit entry", async () => {
    const clinic = clinicBySlug("serenity");
    const sent = await invite(clinic.id, "audit-token@example.com");
    const first = sent.token ?? "";
    const resent = await api.invitations.resend(admin(clinic.id), sent.id);
    expect(resent.token).not.toBe(first);
    await expect(api.invitations.preview(first)).rejects.toMatchObject({ code: "not_found" });
    await api.invitations.accept(resent.token ?? "", password);
    const audit = JSON.stringify(getState().clinicAudit);
    const hashes = getState().invitations.map((i) => i.tokenHash);
    for (const secret of [
      first,
      resent.token ?? "",
      ...Object.values(getState().inviteOutbox),
      ...hashes,
    ])
      expect(audit.includes(secret)).toBe(false);
    expect(audit.includes("tokenHash")).toBe(false);
  });

  it("refuses to resend an invitation whose role or branch is no longer active", async () => {
    const clinic = clinicBySlug("serenity");
    const branch = getState().branches.find((b) => b.clinicId === clinic.id && b.isActive);
    if (!branch) throw new Error("no branch");
    const sent = await api.invitations.invite(admin(clinic.id), {
      fullName: "Resend Person",
      email: "resend@example.com",
      roleId: roleId(clinic.id, "doctor"),
      allBranches: false,
      branchIds: [branch.id],
    });
    branch.isActive = false;
    await expect(api.invitations.resend(admin(clinic.id), sent.id)).rejects.toMatchObject({
      code: "branch_inactive",
    });
    branch.isActive = true;
    const role = getState().roles.find((r) => r.id === sent.roleId);
    if (!role) throw new Error("no role");
    role.isActive = false;
    await expect(api.invitations.resend(admin(clinic.id), sent.id)).rejects.toMatchObject({
      code: "role_inactive",
    });
    expect(getState().inviteOutbox[sent.id]).toBe(sent.token);
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

  it("lets a new clinic's first admin accept with the link returned by createClinic", async () => {
    const created = await api.platform.createClinic({
      nameAr: "عيادة الاختبار",
      nameEn: "Test Clinic",
      slug: "test-clinic",
      specialty: "dermatology",
      defaultLanguage: "en",
      timezone: "Asia/Kuwait",
      adminName: "First Admin",
      adminEmail: "first.admin@example.com",
    });
    expect(JSON.stringify(getState().platformAudit)).not.toContain(created.firstAdminInvite.token);
    expect(await api.platform.getFirstAdminInvitation(created.clinic.id)).toMatchObject({
      status: "pending",
    });
    const accepted = await api.invitations.accept(created.firstAdminInvite.token, password);
    expect(accepted.roleKey).toBe("clinic_admin");
    const member = getState().members.find((m) => m.id === accepted.memberId);
    expect(member?.preferredLanguage).toBe("en");
    expect(await api.platform.getFirstAdminInvitation(created.clinic.id)).toBeNull();
    await expect(api.platform.resendFirstAdminInvitation(created.clinic.id)).rejects.toMatchObject({
      code: "invitation_used",
    });
  });

  it("never sends invitation tokens to a view-only role", async () => {
    const clinic = clinicBySlug("serenity");
    const base = getState().roles.find((r) => r.id === roleId(clinic.id, "doctor"));
    if (!base) throw new Error("no role");
    const viewer = {
      ...base,
      id: crypto.randomUUID(),
      systemKey: null,
      nameAr: "مطّلع",
      nameEn: "Viewer",
      permissions: ["view:users:clinic"],
    };
    getState().roles.push(viewer as typeof base);
    const member = getState().members.find(
      (m) => m.clinicId === clinic.id && m.status === "active" && m.roleId === base.id,
    );
    if (!member) throw new Error("no member");
    member.roleId = viewer.id;
    const persona: Persona = { kind: "custom", clinicId: clinic.id, memberId: member.id };
    const page = await api.invitations.list(persona, {
      cursor: null,
      limit: 50,
      search: "",
      status: null,
    });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((i) => i.token === null)).toBe(true);
    const adminPage = await api.invitations.list(admin(clinic.id), {
      cursor: null,
      limit: 50,
      search: "",
      status: "pending",
    });
    expect(adminPage.items.some((i) => typeof i.token === "string")).toBe(true);
  });
});
