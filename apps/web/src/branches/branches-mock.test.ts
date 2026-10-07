import { beforeEach, describe, expect, it } from "vitest";
import { api, as, clinicIdAt, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { ApiError } from "@/shared/api/api-error";

beforeEach(() => resetMockData());
const input = { nameAr: "فرع", nameEn: "Replay Branch", address: "", phone: "" };

async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e instanceof ApiError ? e : null;
  }
  return null;
}

describe("branch create replays on the same Idempotency-Key", () => {
  it("returns the first branch and creates nothing new", async () => {
    const admin = as("clinic_admin");
    const before = getState().branches.length;
    const first = await api.branches.create(admin, input, "same-key");
    const again = await api.branches.create(admin, input, "same-key");
    expect(again.id).toBe(first.id);
    expect(getState().branches.length).toBe(before + 1);
  });
  it("a changed request under the same key is a conflict", async () => {
    const admin = as("clinic_admin");
    await api.branches.create(admin, input, "k2");
    const error = await failure(api.branches.create(admin, { ...input, nameEn: "Other" }, "k2"));
    expect(error?.code).toBe("idempotency_conflict");
  });
});

describe("deactivating a branch some users rely on alone", () => {
  function strandOne() {
    const clinicId = clinicIdAt(0);
    const db = getState();
    const branch = db.branches.find((b) => b.clinicId === clinicId && b.isActive)!;
    const member =
      db.members.find(
        (m) => m.clinicId === clinicId && m.status === "active" && m.allBranches === false,
      ) ??
      db.members.find(
        (m) =>
          m.clinicId === clinicId &&
          m.status === "active" &&
          db.roles.find((r) => r.id === m.roleId)?.systemKey !== "clinic_admin",
      )!;
    member.allBranches = false;
    member.branchIds = [branch.id];
    for (const other of db.members) {
      if (other !== member && other.clinicId === clinicId && !other.allBranches) {
        other.allBranches = true;
        other.branchIds = [];
      }
    }
    return branch;
  }
  it("is refused with branch_has_exclusive_members and the count", async () => {
    const branch = strandOne();
    const error = await failure(api.branches.deactivate(as("clinic_admin"), branch.id));
    expect(error?.code).toBe("branch_has_exclusive_members");
    expect(error?.details["count"]).toBe(1);
    expect(getState().branches.find((b) => b.id === branch.id)?.isActive).toBe(true);
  });
  it("succeeds once confirmed", async () => {
    const branch = strandOne();
    const done = await api.branches.deactivate(as("clinic_admin"), branch.id, {
      confirmStrandedMembers: true,
    });
    expect(done.isActive).toBe(false);
  });
});
