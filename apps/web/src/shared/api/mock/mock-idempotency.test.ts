import { beforeEach, describe, expect, it } from "vitest";
import type { Persona } from "@eyadex/contracts/session";
import { api, as, clinicIdAt, getState, PLATFORM, resetMockData } from "./mock-test-kit";

// The API claims an Idempotency-Key per operation AND acting user (`branch:create:<userId>`…), so
// the mock must not let one user's key replay, or conflict with, another user's create.

const clinicOf = (persona: Persona) => persona.clinicId ?? "";

/** A second clinic admin of the clinic: an active non-admin member promoted onto the admin role. */
function secondAdmin(index: number): Persona {
  const db = getState();
  const clinicId = clinicIdAt(index);
  const adminRole = db.roles.find((r) => r.clinicId === clinicId && r.systemKey === "clinic_admin");
  const member = db.members.find(
    (m) => m.clinicId === clinicId && m.status === "active" && m.roleId !== adminRole?.id,
  );
  if (!adminRole || !member) throw new Error("seed");
  member.roleId = adminRole.id;
  member.allBranches = true;
  member.branchIds = [];
  return { kind: "clinic_admin", clinicId, memberId: member.id };
}

function firstBranch(clinicId: string): string {
  const branch = getState().branches.find((b) => b.clinicId === clinicId && b.isActive);
  if (!branch) throw new Error("seed");
  return branch.id;
}

function doctorRole(clinicId: string): string {
  const role = getState().roles.find((r) => r.clinicId === clinicId && r.systemKey === "doctor");
  if (!role) throw new Error("seed");
  return role.id;
}

type Variant = "a" | "b";
const PHONES: Record<Variant, string> = { a: "55501111", b: "55502222" };

const ledgers = [
  {
    name: "branch create",
    create: (p: Persona, v: Variant, key: string) =>
      api.branches.create(
        p,
        { nameAr: `فرع ${v}`, nameEn: `Branch ${v}`, address: "", phone: "" },
        key,
      ),
  },
  {
    name: "invitation",
    create: (p: Persona, v: Variant, key: string) =>
      api.invitations.invite(
        p,
        {
          fullName: `Person ${v}`,
          email: `scope-${v}@example.com`,
          roleId: doctorRole(clinicOf(p)),
          allBranches: true,
          branchIds: [],
        },
        key,
      ),
  },
  {
    name: "patient create",
    create: (p: Persona, v: Variant, key: string) =>
      api.patients.create(
        p,
        {
          fullName: `مراجع ${v}`,
          phone: PHONES[v],
          birthDate: "1990-04-01",
          gender: "male",
          registrationBranchId: firstBranch(clinicOf(p)),
          civilId: "",
        },
        key,
      ),
  },
];

beforeEach(() => {
  resetMockData();
  // Room for the extra rows: the seat and branch limits are not what these tests are about.
  for (const clinic of getState().clinics) {
    clinic.maxBranches = 20;
    clinic.maxUsers = 50;
  }
});

// Same-user replay and conflict are already covered per area (branches-mock, invitation-safety,
// patients-records); these add the scope the API keys on.
describe.each(ledgers)("$name idempotency is scoped by the acting user", ({ create }) => {
  it("another user of the same clinic with the same key creates their own row", async () => {
    const admin = as("clinic_admin", 0);
    const other = secondAdmin(0);
    const key = crypto.randomUUID();
    const mine = await create(admin, "a", key);
    const theirs = await create(other, "b", key);
    expect(theirs.id).not.toBe(mine.id);
    expect((await create(other, "b", key)).id).toBe(theirs.id);
    expect((await create(admin, "a", key)).id).toBe(mine.id);
  });

  it("a key used in one clinic never collides with another clinic", async () => {
    const key = crypto.randomUUID();
    const here = await create(as("clinic_admin", 0), "a", key);
    const there = await create(as("clinic_admin", 1), "b", key);
    expect(there.id).not.toBe(here.id);
  });
});

describe("invitation fingerprint, like the API's hash of the body", () => {
  it("the same branches sent in another order are another request", async () => {
    const clinicId = clinicIdAt(0);
    const ids = getState()
      .branches.filter((b) => b.clinicId === clinicId && b.isActive)
      .map((b) => b.id)
      .slice(0, 2);
    if (ids.length < 2) throw new Error("seed");
    const body = (branchIds: string[]) => ({
      fullName: "Order Person",
      email: "order@example.com",
      roleId: doctorRole(clinicId),
      allBranches: false,
      branchIds,
    });
    const key = crypto.randomUUID();
    await api.invitations.invite(as("clinic_admin", 0), body(ids), key);
    await expect(
      api.invitations.invite(as("clinic_admin", 0), body([...ids].reverse()), key),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
  });
});

describe("clinic create idempotency is scoped by the platform account", () => {
  const noura = (): Persona => {
    const account = getState().platformAccounts.find((a) => a.email === "noura@eyadex.com");
    if (account?.status !== "active") throw new Error("seed");
    return { kind: "platform_admin", clinicId: null, memberId: account.id };
  };
  const clinic = (v: Variant) => ({
    nameAr: `عيادة ${v}`,
    nameEn: `Clinic ${v}`,
    specialty: "general" as const,
    defaultLanguage: "ar" as const,
    timezone: "Asia/Kuwait",
    slug: `scope-clinic-${v}`,
    adminName: `Admin ${v}`,
    adminEmail: `scope-admin-${v}@example.com`,
  });

  it("the same account, key and body replays the first clinic", async () => {
    const key = crypto.randomUUID();
    const first = await api.platform.createClinic(PLATFORM, clinic("a"), key);
    const before = getState().clinics.length;
    const again = await api.platform.createClinic(PLATFORM, clinic("a"), key);
    expect(again.clinic.id).toBe(first.clinic.id);
    expect(getState().clinics.length).toBe(before);
  });

  it("the same account and key with another body is idempotency_conflict", async () => {
    const key = crypto.randomUUID();
    await api.platform.createClinic(PLATFORM, clinic("a"), key);
    await expect(api.platform.createClinic(PLATFORM, clinic("b"), key)).rejects.toMatchObject({
      code: "idempotency_conflict",
    });
  });

  it("another platform account with the same key creates its own clinic", async () => {
    const key = crypto.randomUUID();
    const mine = await api.platform.createClinic(PLATFORM, clinic("a"), key);
    const theirs = await api.platform.createClinic(noura(), clinic("b"), key);
    expect(theirs.clinic.id).not.toBe(mine.clinic.id);
    expect(theirs.clinic.slug).toBe("scope-clinic-b");
  });

  it("a replay returns the clinic as it is now, as the HTTP adapter reads it back", async () => {
    const key = crypto.randomUUID();
    const first = await api.platform.createClinic(PLATFORM, clinic("a"), key);
    // As after a reload from localStorage: the ledger no longer shares the clinic object.
    const db = getState();
    db.idempotentClinics = structuredClone(db.idempotentClinics ?? {});
    await api.platform.updateClinicDetails(PLATFORM, first.clinic.id, {
      ...clinic("a"),
      nameEn: "Renamed Clinic",
    });
    const again = await api.platform.createClinic(PLATFORM, clinic("a"), key);
    expect(again.clinic.nameEn).toBe("Renamed Clinic");
  });
});
