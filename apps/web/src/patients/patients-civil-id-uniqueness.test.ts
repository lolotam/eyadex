import { beforeEach, describe, expect, it, vi } from "vitest";
import { civilIdBirthDate, isValidKuwaitCivilId } from "@eyadex/contracts/patients";

vi.mock("@/shared/api/mock/mock-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/shared/api/mock/mock-store")>();
  return { ...real, delay: async () => undefined };
});

const { getState, resetMockData } = await import("@/shared/api/mock/mock-store");
const { ALL, api, as, branches, clinicId, input, memberOf, otherBranchThan } =
  await import("./patients-test-kit");

// Well-formed fictional numbers, each one with the birth date its digits 1-7 encode.
const A = "290040112347"; // 1990-04-01
const C = "305090900009"; // 2005-09-09

describe("patients mock: one civil ID per clinic", () => {
  beforeEach(() => resetMockData());

  it("seeds only well-formed numbers that match their patient's birth date", () => {
    const patients = getState().patients;
    expect(patients.some((p) => p.civilId !== null)).toBe(true);
    for (const p of patients) {
      if (p.civilId === null) continue;
      expect(isValidKuwaitCivilId(p.civilId)).toBe(true);
      expect(civilIdBirthDate(p.civilId)).toBe(p.birthDate);
    }
    const perClinic = patients
      .filter((p) => p.civilId !== null)
      .map((p) => `${p.clinicId}:${p.civilId}`);
    expect(new Set(perClinic).size).toBe(perClinic.length);
  });

  it("refuses a second file on the same number, in any written form", async () => {
    const branch = branches()[0];
    if (!branch) throw new Error("no branch");
    const admin = as("clinic_admin");
    const first = await api.patients.create(
      admin,
      input(branch.id, "55501001"),
      crypto.randomUUID(),
    );
    expect(first.detail?.civilId).toBe(A);
    for (const spelling of [A, " ٢٩٠٠٤٠١١٢٣٤٧ ", "290-040-112-347", "۲۹۰۰۴۰۱۱۲۳۴۷"]) {
      await expect(
        api.patients.create(
          admin,
          { ...input(branch.id, "55501002"), civilId: spelling },
          crypto.randomUUID(),
        ),
      ).rejects.toMatchObject({
        code: "patient_civil_id_taken",
        details: { patientId: first.id, fileNumber: first.fileNumber },
      });
    }
    expect(getState().patients.filter((p) => p.civilId === A)).toHaveLength(1);
  });

  it("keeps the number reserved after the file is archived", async () => {
    const branch = branches()[0];
    if (!branch) throw new Error("no branch");
    const admin = as("clinic_admin");
    const first = await api.patients.create(
      admin,
      input(branch.id, "55501003"),
      crypto.randomUUID(),
    );
    await api.patients.archive(admin, first.id);
    await expect(
      api.patients.create(admin, input(branch.id, "55501004"), crypto.randomUUID()),
    ).rejects.toMatchObject({ code: "patient_civil_id_taken" });
    // And restoring does not release it either.
    await api.patients.restore(admin, first.id);
    await expect(
      api.patients.create(admin, input(branch.id, "55501005"), crypto.randomUUID()),
    ).rejects.toMatchObject({ code: "patient_civil_id_taken" });
  });

  it("lets a file keep its own number, and refuses to move it onto another's", async () => {
    const branch = branches()[0];
    if (!branch) throw new Error("no branch");
    const admin = as("clinic_admin");
    const mine = await api.patients.create(
      admin,
      input(branch.id, "55501006"),
      crypto.randomUUID(),
    );
    const other = await api.patients.create(
      admin,
      { ...input(branch.id, "55501007"), birthDate: "2005-09-09", civilId: C },
      crypto.randomUUID(),
    );
    const kept = await api.patients.update(admin, mine.id, {
      ...input(branch.id, mine.detail?.phone ?? "55501006"),
      fullName: "اسم جديد",
    });
    expect(kept.detail?.civilId).toBe(A);
    await expect(
      api.patients.update(admin, other.id, {
        ...input(branch.id, "55501007"),
        birthDate: "1990-04-01",
        civilId: A,
      }),
    ).rejects.toMatchObject({
      code: "patient_civil_id_taken",
      details: { patientId: mine.id, fileNumber: mine.fileNumber },
    });
  });

  it("lets two clinics hold the same person", async () => {
    const branch = branches()[0];
    const target = getState().branches.find((b) => getState().clinics[1]?.id === b.clinicId);
    if (!branch || !target) throw new Error("no branch");
    await api.patients.create(
      as("clinic_admin"),
      input(branch.id, "55501008"),
      crypto.randomUUID(),
    );
    const inOtherClinic = await api.patients.create(
      as("clinic_admin", 1),
      input(target.id, "55501009"),
      crypto.randomUUID(),
    );
    expect(inOtherClinic.detail?.civilId).toBe(A);
  });

  it("leaks nothing about a duplicate outside the caller's scope", async () => {
    const own = memberOf("receptionist").branchIds;
    const outside = otherBranchThan(own);
    const admin = as("clinic_admin");
    await api.patients.create(
      admin,
      { ...input(outside.id, "55501010"), birthDate: "2005-09-09", civilId: C },
      crypto.randomUUID(),
    );
    const error = await api.patients
      .create(
        as("receptionist"),
        { ...input(own[0] ?? "", "55501011"), birthDate: "2005-09-09", civilId: C },
        crypto.randomUUID(),
      )
      .catch((e: unknown) => e);
    // Indistinguishable from any other invalid input: no hidden file is confirmed.
    expect(error).toMatchObject({ code: "validation" });
    expect(JSON.stringify(error)).not.toContain(C);
  });

  it("never writes the number into an audit entry, a message or error details", async () => {
    const branch = branches()[0];
    if (!branch) throw new Error("no branch");
    const admin = as("clinic_admin");
    await api.patients.create(admin, input(branch.id, "55501012"), crypto.randomUUID());
    const error = await api.patients
      .create(admin, input(branch.id, "55501013"), crypto.randomUUID())
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "patient_civil_id_taken" });
    const text = JSON.stringify({ error, audit: getState().clinicAudit });
    expect(text).not.toContain(A);
    expect(text).not.toContain("civilId");
    // The refused write left no trace at all.
    expect(getState().clinicAudit).toHaveLength(1);
  });

  it("checks the permission before the number", async () => {
    const branch = branches()[0];
    if (!branch) throw new Error("no branch");
    const taken = getState().patients.find((p) => p.clinicId === clinicId() && p.civilId !== null);
    if (!taken?.civilId) throw new Error("no patient");
    // A view-only Doctor, with a number that is both taken and would fail the schema.
    await expect(
      api.patients.create(
        as("doctor"),
        { ...input(branch.id, "55501014"), civilId: "not-an-id" },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      api.patients.create(
        as("doctor"),
        { ...input(branch.id, "55501014"), birthDate: taken.birthDate, civilId: taken.civilId },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("still finds a file by the digits of its number", async () => {
    const branch = branches()[0];
    if (!branch) throw new Error("no branch");
    const admin = as("clinic_admin");
    const created = await api.patients.create(
      admin,
      input(branch.id, "55501015"),
      crypto.randomUUID(),
    );
    const list = await api.patients.list(admin, { ...ALL, q: "0112347" });
    expect(list.items.map((p) => p.id)).toContain(created.id);
    expect(list.items[0]?.civilIdLast4).toBe("2347");
  });
});
