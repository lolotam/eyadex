import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Persona } from "@eyadex/contracts/session";

vi.mock("@/shared/api/mock/mock-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/shared/api/mock/mock-store")>();
  return { ...real, delay: async () => undefined };
});

const { createMockApiClient } = await import("@/shared/api/mock/mock-adapter");
const { getState, resetMockData } = await import("@/shared/api/mock/mock-store");

// The granting bound (ADR-0017) on every mock path that puts someone on a role, as the API does.
const api = createMockApiClient();
const STRONG = ["view:users:clinic", "update:users:clinic", "view:branches:clinic"];

function clinicId() {
  const clinic = getState().clinics[0];
  if (!clinic) throw new Error("no clinic");
  return clinic.id;
}
const admin = (): Persona => ({ kind: "clinic_admin", clinicId: clinicId(), memberId: null });
let tag = 0;
const roleWith = async (keys: string[]) =>
  (
    await api.roles.create(
      admin(),
      { nameAr: `دور ${++tag}`, nameEn: `Role ${tag}`, permissionKeys: keys },
      crypto.randomUUID(),
    )
  ).id;
const used = new Set<string>();

/** A not-yet-used active, non-admin member moved onto a fresh role holding exactly `keys`. */
async function memberWith(keys: string[]) {
  const roleId = await roleWith(keys);
  const isAdmin = (id: string) =>
    getState().roles.find((r) => r.id === id)?.systemKey === "clinic_admin";
  const member = getState().members.find(
    (m) =>
      m.clinicId === clinicId() && m.status === "active" && !isAdmin(m.roleId) && !used.has(m.id),
  );
  if (!member) throw new Error("no member left");
  used.add(member.id);
  member.roleId = roleId;
  member.allBranches = true;
  member.branchIds = [];
  const persona: Persona = { kind: "custom", clinicId: clinicId(), memberId: member.id };
  return { persona, memberId: member.id };
}
const inviteInput = (roleId: string) => ({
  fullName: "Invited Person",
  email: `person-${crypto.randomUUID().slice(0, 8)}@example.test`,
  roleId,
  allBranches: true,
  branchIds: [],
});
const forbidden = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: "forbidden" });

describe("role grants (ADR-0017 §6, mock)", () => {
  beforeEach(() => {
    resetMockData();
    used.clear();
  });

  it("refuses reactivating a stronger role, then assigning it to oneself", async () => {
    const actor = await memberWith(["view:roles:clinic", "deactivate:roles:clinic"]);
    const dormant = await roleWith(STRONG);
    await api.roles.deactivate(admin(), dormant);
    await forbidden(api.roles.reactivate(actor.persona, dormant));
    const assigner = await memberWith(["view:users:clinic", "update:users:clinic"]);
    await api.roles.reactivate(admin(), dormant);
    await forbidden(api.users.changeRole(assigner.persona, assigner.memberId, { roleId: dormant }));
  });

  it("refuses change role and member reactivation onto a stronger role", async () => {
    const strong = await roleWith(STRONG);
    const actor = await memberWith(["view:users:clinic", "update:users:clinic"]);
    const target = await memberWith(["view:users:clinic"]);
    await forbidden(api.users.changeRole(actor.persona, target.memberId, { roleId: strong }));
    const within = await roleWith(["view:users:clinic", "update:users:clinic"]);
    const moved = await api.users.changeRole(actor.persona, target.memberId, { roleId: within });
    expect(moved.roleId).toBe(within);
    const reactivator = await memberWith(["view:users:clinic", "deactivate:users:clinic"]);
    await api.users.changeRole(admin(), target.memberId, { roleId: strong });
    await api.users.deactivate(admin(), target.memberId);
    await forbidden(api.users.reactivate(reactivator.persona, target.memberId));
  });

  it("refuses invite, resend and copy link on a stronger role", async () => {
    const strong = await roleWith(STRONG);
    const actor = await memberWith(["view:users:clinic", "create:users:clinic"]);
    await forbidden(
      api.invitations.invite(actor.persona, inviteInput(strong), crypto.randomUUID()),
    );
    const weak = await roleWith(["view:users:clinic"]);
    await api.invitations.invite(actor.persona, inviteInput(weak), crypto.randomUUID());
    const sent = await api.invitations.invite(admin(), inviteInput(strong), crypto.randomUUID());
    await forbidden(api.invitations.resend(actor.persona, sent.id));
    await forbidden(api.invitations.copyLink(actor.persona, sent.id));
  });

  it("refuses a branch-scoped grantor giving a role to an all-branch member", async () => {
    const weak = await roleWith(["view:users:clinic"]);
    const actor = await memberWith(["view:users:clinic", "update:users:clinic"]);
    const branch = getState().branches.find((b) => b.clinicId === clinicId() && b.isActive)!;
    const self = getState().members.find((m) => m.id === actor.memberId)!;
    self.allBranches = false;
    self.branchIds = [branch.id];
    const target = await memberWith(["view:users:clinic"]);
    await forbidden(api.users.changeRole(actor.persona, target.memberId, { roleId: weak }));
  });

  it("counts a role's key of a switched-off module", async () => {
    getState().features[clinicId()] = { patients: false, appointments: false, medical: false };
    const hidden = await roleWith([]);
    getState()
      .roles.find((r) => r.id === hidden)!
      .permissions.push("view:patients:branch");
    const actor = await memberWith(["view:users:clinic", "update:users:clinic"]);
    await forbidden(api.users.changeRole(actor.persona, actor.memberId, { roleId: hidden }));
  });

  it("leaves the clinic admin unaffected", async () => {
    const strong = await roleWith(STRONG);
    await api.roles.deactivate(admin(), strong);
    expect((await api.roles.reactivate(admin(), strong)).isActive).toBe(true);
    const target = await memberWith(["view:users:clinic"]);
    const moved = await api.users.changeRole(admin(), target.memberId, { roleId: strong });
    expect(moved.roleId).toBe(strong);
    const sent = await api.invitations.invite(admin(), inviteInput(strong), crypto.randomUUID());
    await expect(api.invitations.copyLink(admin(), sent.id)).resolves.toBeTruthy();
  });
});

// Codex r2: `own` is the narrowest scope; a branch key covers it, as the API's grantFor.
describe("the own scope when defining a role (mock, as the API)", () => {
  beforeEach(() => resetMockData());

  it("an all-branch actor holding view:appointments:branch may define a role with the own key", async () => {
    const { persona } = await memberWith([
      "view:roles:clinic",
      "create:roles:clinic",
      "view:appointments:branch",
    ]);
    const made = await api.roles.create(
      persona,
      { nameAr: "دور خاص", nameEn: "Own role", permissionKeys: ["view:appointments:own"] },
      crypto.randomUUID(),
    );
    expect(made.permissionKeys).toEqual(["view:appointments:own"]);
  });
});

// Codex A3 r1: view:patients:own crosses branches; only view:patients:clinic covers it, as the API.
describe("granting view:patients:own (mock, as the API)", () => {
  beforeEach(() => resetMockData());

  it("a branch key does not cover it; the clinic key does", async () => {
    const keys = ["view:roles:clinic", "create:roles:clinic"];
    const input = {
      nameAr: "دور ملفاتي",
      nameEn: "Own files",
      permissionKeys: ["view:patients:own"],
    };
    const branch = await memberWith([...keys, "view:patients:branch"]);
    await forbidden(api.roles.create(branch.persona, input, crypto.randomUUID()));
    const clinic = await memberWith([...keys, "view:patients:clinic"]);
    const made = await api.roles.create(clinic.persona, input, crypto.randomUUID());
    expect(made.permissionKeys).toEqual(["view:patients:own"]);
  });
});
