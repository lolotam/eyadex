import { beforeEach, describe, expect, it } from "vitest";
import { api, as, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";

// P2 spec §2: the locked admin may delegate visits/medical keys without holding them; nobody else
// grants a key they lack; own medical/visits keys are clinic-bound.
beforeEach(() => resetMockData());

const roleInput = (permissionKeys: string[]) => ({
  nameAr: `دور ${crypto.randomUUID().slice(0, 6)}`,
  nameEn: `Role ${crypto.randomUUID().slice(0, 6)}`,
  permissionKeys,
});

describe("medical key grants (mock)", () => {
  it("the locked admin creates a role holding create:visits:own and the medical keys", async () => {
    const role = await api.roles.create(
      as("clinic_admin"),
      roleInput(["view:visits:own", "create:visits:own", "view:medical:own", "update:medical:own"]),
      crypto.randomUUID(),
    );
    expect(role.permissionKeys).toContain("create:visits:own");
  });

  it("a role editor without the medical keys cannot grant them", async () => {
    const admin = as("clinic_admin");
    const db = getState();
    const clinicId = db.clinics[0]!.id;
    const editor = await api.roles.create(
      admin,
      roleInput(["view:roles:clinic", "create:roles:clinic", "view:visits:branch"]),
      crypto.randomUUID(),
    );
    const me = db.members.find((m) => m.clinicId === clinicId && m.status === "active")!;
    const member = { ...me, id: crypto.randomUUID(), roleId: editor.id, allBranches: true };
    db.members.push(member);
    const persona = { kind: "custom" as const, clinicId, memberId: member.id };
    await expect(
      api.roles.create(persona, roleInput(["view:medical:own"]), crypto.randomUUID()),
    ).rejects.toMatchObject({ code: "forbidden" });
    // own visits keys are clinic-bound: a branch key does not cover them.
    await expect(
      api.roles.create(persona, roleInput(["view:visits:own"]), crypto.randomUUID()),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
