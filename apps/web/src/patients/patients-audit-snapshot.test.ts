import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/api/mock/mock-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/shared/api/mock/mock-store")>();
  return { ...real, delay: async () => undefined };
});

const { getState, resetMockData } = await import("@/shared/api/mock/mock-store");
const { maskAuditPhone } = await import("@/shared/api/mock/mock-patient-rules");
const { api, as, branches, input } = await import("./patients-test-kit");

// The mock's patient audit snapshot mirrors the API's (ADR-0018): an allowlist with the phone masked
// to its last 3 digits, no birth date and no civil ID in any form.
describe("patients mock: audit snapshot", () => {
  beforeEach(() => resetMockData());

  it("masks a phone to its last 3 digits", () => {
    expect(maskAuditPhone("+96555501234")).toBe("***234");
    expect(maskAuditPhone("12")).toBe("***");
  });

  it("create and update snapshots carry the allowlist only", async () => {
    const branch = branches()[0];
    if (!branch) throw new Error("no branch");
    const admin = as("clinic_admin");
    const body = input(branch.id, "55501234");
    const created = await api.patients.create(admin, body, crypto.randomUUID());
    await api.patients.update(admin, created.id, { ...body, fullName: "Edited" });
    const entries = getState().clinicAudit.filter(
      (e) => e.entity === "patient" && (e.after as { id?: string } | null)?.id === created.id,
    );
    expect(entries.map((e) => e.action).sort()).toEqual(["patient.created", "patient.updated"]);
    for (const entry of entries) {
      for (const snap of [entry.before, entry.after]) {
        if (snap === null) continue;
        expect(Object.keys(snap).sort()).toEqual(
          [
            "fileNumber",
            "fullName",
            "gender",
            "id",
            "phone",
            "registrationBranchId",
            "status",
          ].sort(),
        );
        expect(snap).toMatchObject({ phone: "***234" });
      }
      const text = JSON.stringify(entry);
      expect(text).not.toContain(body.civilId);
      expect(text).not.toContain("55501234");
    }
  });
});
