import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Persona } from "@contracts/session";

vi.mock("@/shared/api/mock/mock-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/shared/api/mock/mock-store")>();
  return { ...real, delay: async () => undefined };
});

const { createMockApiClient } = await import("@/shared/api/mock/mock-adapter");
const { getState, resetMockData } = await import("@/shared/api/mock/mock-store");

const api = createMockApiClient();

function clinicId(slug: string) {
  const clinic = getState().clinics.find((c) => c.slug === slug);
  if (!clinic) throw new Error(slug);
  return clinic.id;
}
function admin(id: string): Persona {
  return { kind: "clinic_admin", clinicId: id, memberId: null };
}
function doctorRole(id: string) {
  const role = getState().roles.find((r) => r.clinicId === id && r.systemKey === "doctor");
  if (!role) throw new Error("doctor role");
  return role.id;
}

beforeEach(() => resetMockData());

describe("invitation safety", () => {
  it("rejects an idempotency key reused with a different invitation", async () => {
    const id = clinicId("serenity");
    const base = {
      fullName: "Key Person",
      roleId: doctorRole(id),
      allBranches: true,
      branchIds: [],
    };
    await api.invitations.invite(admin(id), { ...base, email: "key@example.com" }, "same-key");
    await expect(
      api.invitations.invite(admin(id), { ...base, email: "other@example.com" }, "same-key"),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("reveals only the status for a token that can no longer be accepted", async () => {
    const id = clinicId("serenity");
    const sent = await api.invitations.invite(
      admin(id),
      {
        fullName: "Private Person",
        email: "private@example.com",
        roleId: doctorRole(id),
        allBranches: true,
        branchIds: [],
      },
      crypto.randomUUID(),
    );
    const token = getState().inviteOutbox[sent.id];
    if (!token) throw new Error("no token");
    expect((await api.invitations.preview(token)).email).toBe("private@example.com");
    await api.invitations.cancel(admin(id), sent.id);
    const preview = await api.invitations.preview(token);
    expect(preview.status).toBe("cancelled");
    expect(JSON.stringify(preview)).not.toContain("private@example.com");
    expect(preview.fullName).toBe("");
  });
});
