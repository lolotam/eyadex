import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Persona } from "@eyadex/contracts/session";

vi.mock("@/shared/api/mock/mock-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/shared/api/mock/mock-store")>();
  return { ...real, delay: async () => undefined };
});

const { createMockApiClient } = await import("@/shared/api/mock/mock-adapter");
const { getState, resetMockData } = await import("@/shared/api/mock/mock-store");

const api = createMockApiClient();
const password = "Corr3ct-Horse-Battery";

const clinic = () => getState().clinics.find((c) => c.slug === "serenity")!;
const admin = (): Persona => ({ kind: "clinic_admin", clinicId: clinic().id, memberId: null });
const roleId = (key: string) =>
  getState().roles.find((r) => r.clinicId === clinic().id && r.systemKey === key)!.id;
const emailed = (id: string) => getState().inviteOutbox[id] ?? "";

function invite(email: string, role = "doctor", persona = admin()) {
  return api.invitations.invite(
    persona,
    { fullName: "Link Person", email, roleId: roleId(role), allBranches: true, branchIds: [] },
    crypto.randomUUID(),
  );
}

/** A clinic member moved onto a custom role holding exactly these keys. */
function personaWith(permissions: string[]): Persona {
  const base = getState().roles.find((r) => r.id === roleId("doctor"))!;
  const role = { ...base, id: crypto.randomUUID(), systemKey: null, permissions };
  getState().roles.push(role as typeof base);
  const member = getState().members.find(
    (m) => m.clinicId === clinic().id && m.status === "active" && m.roleId === base.id,
  )!;
  member.roleId = role.id;
  return { kind: "custom", clinicId: clinic().id, memberId: member.id };
}

describe("copy invitation link (mock)", () => {
  beforeEach(() => resetMockData());

  it("returns a working link once and kills the emailed one", async () => {
    const sent = await invite("copy-1@example.test");
    const old = emailed(sent.id);
    const link = await api.invitations.copyLink(admin(), sent.id);
    expect(link.token).not.toBe(old);
    expect(emailed(sent.id)).toBe("");
    await expect(api.invitations.accept(old, password)).rejects.toMatchObject({
      code: "not_found",
    });
    await api.invitations.accept(link.token, password);
  });

  it("resend also kills the earlier link", async () => {
    const sent = await invite("copy-2@example.test");
    const link = await api.invitations.copyLink(admin(), sent.id);
    await api.invitations.resend(admin(), sent.id);
    await expect(api.invitations.preview(link.token)).rejects.toMatchObject({ code: "not_found" });
    await api.invitations.accept(emailed(sent.id), password);
  });

  it("audits link_copied without the token", async () => {
    const sent = await invite("copy-3@example.test");
    const link = await api.invitations.copyLink(admin(), sent.id);
    const rows = getState().clinicAudit.filter((e) => e.action === "invitation.link_copied");
    expect(rows).toHaveLength(1);
    const raw = JSON.stringify(getState().clinicAudit);
    expect(raw.includes(link.token)).toBe(false);
    expect(raw.includes("tokenHash")).toBe(false);
  });

  it("needs create users, and an admin for the clinic-admin role", async () => {
    const sent = await invite("copy-4@example.test", "clinic_admin");
    const viewer = personaWith(["view:users:clinic"]);
    await expect(api.invitations.copyLink(viewer, sent.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    const manager = personaWith(["view:users:clinic", "create:users:clinic"]);
    await expect(api.invitations.copyLink(manager, sent.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(api.invitations.copyLink(admin(), sent.id)).resolves.toHaveProperty("token");
  });

  it("refuses accepted, cancelled and unknown invitations", async () => {
    const used = await invite("copy-5@example.test");
    await api.invitations.accept(emailed(used.id), password);
    await expect(api.invitations.copyLink(admin(), used.id)).rejects.toMatchObject({
      code: "invitation_used",
    });
    const gone = await invite("copy-6@example.test");
    await api.invitations.cancel(admin(), gone.id);
    await expect(api.invitations.copyLink(admin(), gone.id)).rejects.toMatchObject({
      code: "invitation_cancelled",
    });
    await expect(api.invitations.copyLink(admin(), crypto.randomUUID())).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("needs a free seat for an expired invitation", async () => {
    const sent = await invite("copy-7@example.test");
    const stored = getState().invitations.find((i) => i.id === sent.id)!;
    stored.expiresAt = new Date(Date.now() - 1000).toISOString();
    const c = clinic();
    const active = getState().members.filter((m) => m.clinicId === c.id && m.status === "active");
    const live = getState().invitations.filter(
      (i) => i.clinicId === c.id && i.status === "pending" && new Date(i.expiresAt) > new Date(),
    );
    c.maxUsers = active.length + live.length;
    await expect(api.invitations.copyLink(admin(), sent.id)).rejects.toMatchObject({
      code: "limit_reached",
    });
  });
});
