import { beforeEach, describe, expect, it, vi } from "vitest";
import { NO_FEATURES } from "@eyadex/contracts/clinics";
import type { Persona } from "@eyadex/contracts/session";

vi.mock("@/shared/api/mock/mock-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/shared/api/mock/mock-store")>();
  return { ...real, delay: async () => undefined };
});

const { createMockApiClient } = await import("@/shared/api/mock/mock-adapter");
const { getState, resetMockData } = await import("@/shared/api/mock/mock-store");

// Issue #93, as the API serves it: a view key must cover the scope of the writes it unlocks.
const api = createMockApiClient();
const NARROW = ["view:payments:branch", "create:payments:clinic"];
const FIXED = ["view:payments:clinic", "create:payments:clinic"];

function clinicId() {
  const clinic = getState().clinics[0];
  if (!clinic) throw new Error("no clinic");
  return clinic.id;
}
const admin = (): Persona => ({ kind: "clinic_admin", clinicId: clinicId(), memberId: null });
const names = { nameAr: "دور الدفع", nameEn: "Payments role" };

/** A role stored before the rule existed, written straight into the mock store. */
function storedNarrowRole(): string {
  const id = crypto.randomUUID();
  getState().roles.push({
    id,
    clinicId: clinicId(),
    systemKey: null,
    ...names,
    isLocked: false,
    isActive: true,
    permissions: [...NARROW],
  });
  return id;
}

describe("the view-scope rule (mock)", () => {
  beforeEach(() => resetMockData());

  it("NEGATIVE: refuses to create a role whose view is narrower than its write", async () => {
    const before = getState().roles.length;
    await expect(
      api.roles.create(admin(), { ...names, permissionKeys: NARROW }, crypto.randomUUID()),
    ).rejects.toMatchObject({ code: "validation" });
    expect(getState().roles).toHaveLength(before);
  });

  it("still lists a stored role that breaks the rule, its keys untouched", async () => {
    const id = storedNarrowRole();
    const listed = (await api.roles.list(admin())).find((r) => r.id === id);
    expect(listed?.permissionKeys).toEqual(NARROW);
  });

  it("NEGATIVE: refuses that role's next save until its view is widened", async () => {
    const id = storedNarrowRole();
    await expect(
      api.roles.update(admin(), id, { ...names, permissionKeys: NARROW }),
    ).rejects.toMatchObject({ code: "validation" });
    expect(getState().roles.find((r) => r.id === id)?.permissions).toEqual(NARROW);
    const saved = await api.roles.update(admin(), id, { ...names, permissionKeys: FIXED });
    expect([...saved.permissionKeys].sort()).toEqual([...FIXED].sort());
  });

  // PR #98 review: the kept keys of a switched-off module are checked on the saved set, as the API does.
  it("NEGATIVE: with finance off, a save leaving the hidden pair out is refused, naming finance", async () => {
    const id = storedNarrowRole();
    const db = getState();
    db.features[clinicId()] = { ...(db.features[clinicId()] ?? NO_FEATURES), finance: false };
    await expect(
      api.roles.update(admin(), id, { nameAr: "دور آخر", nameEn: "Other", permissionKeys: [] }),
    ).rejects.toMatchObject({ code: "role_hidden_keys_invalid", details: { module: "finance" } });
    expect(getState().roles.find((r) => r.id === id)).toMatchObject({
      nameEn: names.nameEn,
      permissions: NARROW,
    });
  });
});
