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
    await expect(api.invitations.accept(expired.id, password)).rejects.toMatchObject({
      code: "invitation_expired",
    });
    const sent = await invite(clinic.id, "joiner@example.com");
    const accepted = await api.invitations.accept(sent.token, password);
    expect(getState().members.some((m) => m.id === accepted.memberId)).toBe(true);
    await expect(api.invitations.accept(sent.token, password)).rejects.toMatchObject({
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
});
