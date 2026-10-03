import { beforeEach, describe, expect, it, vi } from "vitest";
import { isBirthDateValid, todayInTimeZone } from "@eyadex/contracts/patients";
import { clinicDetailsInputSchema } from "@eyadex/contracts/clinics";

vi.mock("@/shared/api/mock/mock-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/shared/api/mock/mock-store")>();
  return { ...real, delay: async () => undefined };
});

const { getState, resetMockData } = await import("@/shared/api/mock/mock-store");
const { ALL, api, as, branches, clinicId, input, memberOf, otherBranchThan } =
  await import("./patients-test-kit");

describe("patients mock: records, audit and idempotency", () => {
  beforeEach(() => resetMockData());

  it("rejects duplicate phones written in different forms", async () => {
    const branch = branches()[0];
    if (!branch) throw new Error("no branch");
    const created = await api.patients.create(
      as("clinic_admin"),
      input(branch.id, "5550 1234"),
      crypto.randomUUID(),
    );
    expect(created.detail?.phone).toBe("+96555501234");
    for (const spelling of ["55501234", "+965 5550-1234", "0096555501234"]) {
      await expect(
        api.patients.create(as("clinic_admin"), input(branch.id, spelling), crypto.randomUUID()),
      ).rejects.toMatchObject({
        code: "patient_phone_taken",
        details: { patientId: created.id, fileNumber: created.fileNumber },
      });
    }
  });

  it("assigns sequential file numbers and never reuses archived ones", async () => {
    const branch = branches()[0];
    if (!branch) throw new Error("no branch");
    const start = getState().patientCounters[clinicId()] ?? 0;
    // No civil ID: this test is about numbers, and two files can never share one.
    const a = await api.patients.create(
      as("clinic_admin"),
      { ...input(branch.id, "55500001"), civilId: "" },
      crypto.randomUUID(),
    );
    await api.patients.archive(as("clinic_admin"), a.id);
    const b = await api.patients.create(
      as("clinic_admin"),
      { ...input(branch.id, "55500002"), civilId: "" },
      crypto.randomUUID(),
    );
    expect(a.fileNumber).toBe(start + 1);
    expect(b.fileNumber).toBe(start + 2);
  });

  it("audits opening a file as patient access", async () => {
    const patient = getState().patients.find((p) => p.clinicId === clinicId());
    if (!patient) throw new Error("no patient");
    await api.patients.list(as("clinic_admin"), ALL);
    expect(getState().clinicAudit).toHaveLength(0);
    await api.patients.open(as("clinic_admin"), patient.id);
    expect(getState().clinicAudit[0]).toMatchObject({
      action: "patient.opened",
      entity: "patient",
      category: "patient_access",
      entityId: patient.id,
    });
  });

  it("never writes civilId into any audit entry", async () => {
    const branch = branches()[0];
    if (!branch) throw new Error("no branch");
    const admin = as("clinic_admin");
    const p = await api.patients.create(admin, input(branch.id), crypto.randomUUID());
    const moved = "291060243218";
    await api.patients.update(admin, p.id, {
      ...input(branch.id),
      birthDate: "1991-06-02",
      civilId: moved,
    });
    await api.patients.open(admin, p.id);
    await api.patients.archive(admin, p.id);
    await api.patients.restore(admin, p.id);
    const text = JSON.stringify(getState().clinicAudit);
    expect(getState().clinicAudit.length).toBe(5);
    expect(text).not.toContain("civilId");
    expect(text).not.toContain("290040112347");
    expect(text).not.toContain(moved);
  });

  it("judges birth dates by the clinic's calendar, not UTC", async () => {
    // 01:30 in Kuwait on 15 March is still 14 March in UTC.
    const now = new Date("2026-03-14T22:30:00Z");
    expect(todayInTimeZone("Asia/Kuwait", now)).toBe("2026-03-15");
    expect(isBirthDateValid("2026-03-15", todayInTimeZone("Asia/Kuwait", now))).toBe(true);
    expect(isBirthDateValid("2026-03-16", todayInTimeZone("Asia/Kuwait", now))).toBe(false);
    expect(isBirthDateValid("2026-02-30", "2026-03-15")).toBe(false);
  });

  it("replays a retried create with the same key and refuses a changed request", async () => {
    const branch = branches()[0]!;
    const admin = as("clinic_admin");
    const key = crypto.randomUUID();
    const first = await api.patients.create(admin, input(branch.id, "55507777"), key);
    const retry = await api.patients.create(admin, input(branch.id, "55507777"), key);
    expect(retry.id).toBe(first.id);
    expect(getState().patients.filter((p) => p.phone === "+96555507777")).toHaveLength(1);
    await expect(
      api.patients.create(admin, input(branch.id, "55508888"), key),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("does not replay a create whose file left the caller's scope", async () => {
    const member = memberOf("receptionist");
    const own = member.branchIds[0];
    if (!own || member.branchIds.length < 1) throw new Error("seed");
    const key = crypto.randomUUID();
    const persona = as("receptionist");
    await api.patients.create(persona, input(own, "55506666"), key);
    member.branchIds = branches()
      .map((b) => b.id)
      .filter((id) => id !== own);
    await expect(api.patients.create(persona, input(own, "55506666"), key)).rejects.toMatchObject({
      code: expect.stringMatching(/not_found|forbidden/),
    });
  });

  it("replays a create for a create-only role without exposing the file", async () => {
    const db = getState();
    const member = memberOf("receptionist");
    const role = db.roles.find((r) => r.id === member.roleId);
    if (!role) throw new Error("role");
    role.permissions = ["create:patients:branch"];
    const persona = as("receptionist");
    const own = member.branchIds[0] ?? "";
    const key = crypto.randomUUID();
    const first = await api.patients.create(persona, input(own, "55504444"), key);
    const retry = await api.patients.create(persona, input(own, "55504444"), key);
    expect(retry).toEqual(first);
    expect(retry.detail).toBeNull();
  });

  it("accepts only supported clinic time zones", () => {
    const zone = (timezone: string) =>
      clinicDetailsInputSchema.shape.timezone.safeParse(timezone).success;
    expect(zone("Asia/Kuwait")).toBe(true);
    expect(zone("Mars/Olympus")).toBe(false);
  });
});
