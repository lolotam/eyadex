import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Persona } from "@eyadex/contracts/session";

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
/** The mock outbox stands in for the email: it holds the link last sent by email. */
const emailed = (id: string) => getState().inviteOutbox[id] ?? "";
function invite(clinicId: string, email: string, persona = admin(clinicId)) {
  return api.invitations.invite(
    persona,
    {
      fullName: "Test Person",
      email,
      roleId: roleId(clinicId, "doctor"),
      allBranches: true,
      branchIds: [],
    },
    crypto.randomUUID(),
  );
}
const password = { password: "secret-123", confirmPassword: "secret-123" };

beforeEach(() => resetMockData());

describe("invitations mock", () => {
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
    expect((await api.users.usage(admin(clinic.id)))?.used).toBe(5);
    await invite(clinic.id, "new@example.com");
    expect((await api.users.usage(admin(clinic.id)))?.used).toBe(6);

    const fresh = getState().invitations.find((i) => i.email === "new@example.com");
    if (!fresh) throw new Error("missing");
    fresh.expiresAt = new Date(Date.now() - DAY).toISOString();
    expect((await api.users.usage(admin(clinic.id)))?.used).toBe(5);
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
    const token = emailed(sent.id);
    const accepted = await api.invitations.accept(token, password);
    expect(getState().members.some((m) => m.id === accepted.memberId)).toBe(true);
    await expect(api.invitations.accept(token, password)).rejects.toMatchObject({
      code: "invitation_used",
    });
  });

  it("rejects accepting when the invited role was deactivated after the invite", async () => {
    const clinic = clinicBySlug("serenity");
    const sent = await invite(clinic.id, "late-role@example.com");
    const role = getState().roles.find((r) => r.id === sent.roleId);
    if (!role) throw new Error("no role");
    role.isActive = false;
    await expect(api.invitations.accept(emailed(sent.id), password)).rejects.toMatchObject({
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
    const sent = await api.invitations.invite(
      admin(clinic.id),
      {
        fullName: "Branch Person",
        email: "late-branch@example.com",
        roleId: roleId(clinic.id, "doctor"),
        allBranches: false,
        branchIds: [branch.id],
      },
      crypto.randomUUID(),
    );
    branch.isActive = false;
    await expect(api.invitations.accept(emailed(sent.id), password)).rejects.toMatchObject({
      code: "branch_inactive",
    });
    expect(getState().invitations.find((i) => i.id === sent.id)?.status).toBe("pending");
  });

  it("keeps link tokens and their hashes out of every audit entry", async () => {
    const clinic = clinicBySlug("serenity");
    const sent = await invite(clinic.id, "audit-token@example.com");
    const first = emailed(sent.id);
    const resent = await api.invitations.resend(admin(clinic.id), sent.id);
    expect(resent.token).toBeNull();
    expect(emailed(sent.id)).not.toBe(first);
    await expect(api.invitations.preview(first)).rejects.toMatchObject({ code: "not_found" });
    const second = emailed(sent.id);
    await api.invitations.accept(second, password);
    const audit = JSON.stringify(getState().clinicAudit);
    const hashes = getState().invitations.map((i) => i.tokenHash);
    for (const secret of [first, second, ...Object.values(getState().inviteOutbox), ...hashes])
      expect(audit.includes(secret)).toBe(false);
    expect(audit.includes("tokenHash")).toBe(false);
  });

  it("refuses to resend an invitation whose role or branch is no longer active", async () => {
    const clinic = clinicBySlug("serenity");
    const branch = getState().branches.find((b) => b.clinicId === clinic.id && b.isActive);
    if (!branch) throw new Error("no branch");
    const sent = await api.invitations.invite(
      admin(clinic.id),
      {
        fullName: "Resend Person",
        email: "resend@example.com",
        roleId: roleId(clinic.id, "doctor"),
        allBranches: false,
        branchIds: [branch.id],
      },
      crypto.randomUUID(),
    );
    const link = emailed(sent.id);
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
    expect(emailed(sent.id)).toBe(link);
  });

  it("lets a new clinic's first admin accept with the link returned by createClinic", async () => {
    const created = await api.platform.createClinic(
      { kind: "platform_admin", clinicId: null, memberId: null },
      {
        nameAr: "عيادة الاختبار",
        nameEn: "Test Clinic",
        slug: "test-clinic",
        specialty: "dermatology",
        defaultLanguage: "en",
        timezone: "Asia/Kuwait",
        adminName: "First Admin",
        adminEmail: "first.admin@example.com",
        maxUsers: 10,
        maxBranches: 3,
        modules: { patients: true, appointments: true, medical: false, finance: false },
      },
      crypto.randomUUID(),
    );
    expect(JSON.stringify(getState().platformAudit)).not.toContain(created.firstAdminInvite.token);
    expect(
      await api.platform.getFirstAdminInvitation(
        { kind: "platform_admin", clinicId: null, memberId: null },
        created.clinic.id,
      ),
    ).toMatchObject({
      status: "pending",
    });
    const accepted = await api.invitations.accept(created.firstAdminInvite.token ?? "", password);
    expect(accepted.roleKey).toBe("clinic_admin");
    const member = getState().members.find((m) => m.id === accepted.memberId);
    expect(member?.preferredLanguage).toBe("en");
    expect(
      await api.platform.getFirstAdminInvitation(
        { kind: "platform_admin", clinicId: null, memberId: null },
        created.clinic.id,
      ),
    ).toBeNull();
    await expect(
      api.platform.resendFirstAdminInvitation(
        { kind: "platform_admin", clinicId: null, memberId: null },
        created.clinic.id,
      ),
    ).rejects.toMatchObject({
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
    // Like the API: no list response ever carries a token, whoever asks.
    expect(adminPage.items.every((i) => i.token === null)).toBe(true);
  });
  it("replays an invitation retried with the same idempotency key", async () => {
    const clinic = clinicBySlug("serenity");
    const input = {
      fullName: "Retry Person",
      email: "retry@example.com",
      roleId: roleId(clinic.id, "doctor"),
      allBranches: true,
      branchIds: [],
    };
    const first = await api.invitations.invite(admin(clinic.id), input, "key-1");
    const retry = await api.invitations.invite(admin(clinic.id), input, "key-1");
    expect(retry.id).toBe(first.id);
    await expect(api.invitations.invite(admin(clinic.id), input, "key-2")).rejects.toMatchObject({
      code: "email_taken",
    });
  });

  it("records the platform's first-admin invitation in the clinic audit without the token", async () => {
    const created = await api.platform.createClinic(
      { kind: "platform_admin", clinicId: null, memberId: null },
      {
        nameAr: "عيادة التدقيق",
        nameEn: "Audit Clinic",
        slug: "audit-clinic",
        specialty: "obgyn",
        defaultLanguage: "en",
        timezone: "Asia/Kuwait",
        adminName: "First Admin",
        adminEmail: "  First-Admin@Example.com ",
        maxUsers: 10,
        maxBranches: 3,
        modules: { patients: true, appointments: true, medical: false, finance: false },
      },
      crypto.randomUUID(),
    );
    const entries = getState().clinicAudit.filter((e) => e.clinicId === created.clinic.id);
    expect(entries.some((e) => e.action === "invitation.sent")).toBe(true);
    expect(created.firstAdminInvite.email).toBe("first-admin@example.com");
    expect(JSON.stringify(entries)).not.toContain(created.firstAdminInvite.token);
  });
});
