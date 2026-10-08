import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Persona } from "@eyadex/contracts/session";

vi.mock("@/shared/api/mock/mock-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/shared/api/mock/mock-store")>();
  return { ...real, delay: async () => undefined };
});

const { createMockApiClient } = await import("@/shared/api/mock/mock-adapter");
const { getState, resetMockData } = await import("@/shared/api/mock/mock-store");

// The slice-8 rules the API serves (ADR-0017), held by the mock too: idempotent create and the
// granting bound.
const api = createMockApiClient();

function clinicId() {
  const clinic = getState().clinics[0];
  if (!clinic) throw new Error("no clinic");
  return clinic.id;
}
const admin = (): Persona => ({ kind: "clinic_admin", clinicId: clinicId(), memberId: null });
const names = (tag: string) => ({ nameAr: `دور ${tag}`, nameEn: `Role ${tag}` });

/** An active member moved onto a fresh role holding exactly `keys`. */
async function personaWith(keys: string[]): Promise<Persona> {
  const role = await api.roles.create(
    admin(),
    { ...names("editor"), permissionKeys: keys },
    crypto.randomUUID(),
  );
  const isAdmin = (roleId: string) =>
    getState().roles.find((r) => r.id === roleId)?.systemKey === "clinic_admin";
  const member = getState().members.find(
    (m) => m.clinicId === clinicId() && m.status === "active" && !isAdmin(m.roleId),
  );
  if (!member) throw new Error("no member");
  member.roleId = role.id;
  return { kind: "custom", clinicId: clinicId(), memberId: member.id };
}

describe("idempotent role create (mock)", () => {
  beforeEach(() => resetMockData());

  it("the same key and body (keys in another order) replays the first role", async () => {
    const key = crypto.randomUUID();
    const one = await api.roles.create(
      admin(),
      { ...names("a"), permissionKeys: ["view:users:clinic", "view:roles:clinic"] },
      key,
    );
    const two = await api.roles.create(
      admin(),
      { ...names("a"), permissionKeys: ["view:roles:clinic", "view:users:clinic"] },
      key,
    );
    expect(two.id).toBe(one.id);
    expect(getState().roles.filter((r) => r.nameEn === "Role a")).toHaveLength(1);
    expect(getState().clinicAudit.filter((e) => e.entityId === one.id)).toHaveLength(1);
  });

  it("the same key with another body is idempotency_conflict", async () => {
    const key = crypto.randomUUID();
    await api.roles.create(admin(), { ...names("b"), permissionKeys: [] }, key);
    await expect(
      api.roles.create(admin(), { ...names("c"), permissionKeys: [] }, key),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(getState().roles.some((r) => r.nameEn === "Role c")).toBe(false);
  });
});

describe("idempotency is scoped by the actor, like the API (role:create:<userId>)", () => {
  beforeEach(() => resetMockData());

  it("two actors with the same key and different bodies each create their own role", async () => {
    const editor = await personaWith(["view:roles:clinic", "create:roles:clinic"]);
    const key = crypto.randomUUID();
    const mine = await api.roles.create(admin(), { ...names("h"), permissionKeys: [] }, key);
    const theirs = await api.roles.create(editor, { ...names("i"), permissionKeys: [] }, key);
    expect(theirs.id).not.toBe(mine.id);
    expect(theirs.nameEn).toBe("Role i");
    const again = await api.roles.create(editor, { ...names("i"), permissionKeys: [] }, key);
    expect(again.id).toBe(theirs.id);
  });
});

describe("granting bound (ADR-0017, mock)", () => {
  beforeEach(() => resetMockData());

  it("create may only grant keys the actor holds", async () => {
    const editor = await personaWith(["view:roles:clinic", "create:roles:clinic"]);
    await expect(
      api.roles.create(
        editor,
        { ...names("d"), permissionKeys: ["view:users:clinic"] },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    const own = await api.roles.create(
      editor,
      { ...names("e"), permissionKeys: ["view:roles:clinic"] },
      crypto.randomUUID(),
    );
    expect(own.permissionKeys).toEqual(["view:roles:clinic"]);
  });

  it("update may keep a key the actor lacks, never add one", async () => {
    const target = await api.roles.create(
      admin(),
      { ...names("f"), permissionKeys: ["view:users:clinic"] },
      crypto.randomUUID(),
    );
    const editor = await personaWith(["view:roles:clinic", "update:roles:clinic"]);
    const kept = await api.roles.update(editor, target.id, {
      ...names("g"),
      permissionKeys: ["view:users:clinic", "view:roles:clinic"],
    });
    expect(kept.permissionKeys).toEqual(["view:users:clinic", "view:roles:clinic"]);
    await expect(
      api.roles.update(editor, target.id, {
        ...names("g"),
        permissionKeys: ["view:users:clinic", "view:branches:clinic"],
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
