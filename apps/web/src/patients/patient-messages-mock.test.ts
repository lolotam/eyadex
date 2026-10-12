import { beforeEach, describe, expect, it } from "vitest";
import { api, as, clinicIdAt, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";

const admin = () => as("clinic_admin");
const base = () => {
  const branch = getState().branches.find((b) => b.clinicId === clinicIdAt(0))!;
  return {
    fullName: "مراجع تجريبي",
    phone: "55509876",
    birthDate: "1990-04-01",
    gender: "male" as const,
    registrationBranchId: branch.id,
    civilId: "",
    email: "  Visitor@Example.INVALID ",
    messageLanguage: "en" as const,
    notificationsOptOut: true,
  };
};

beforeEach(() => resetMockData());

describe("patient message fields (N-2)", () => {
  it("stores the email lower-cased and trimmed, the language and the opt-out", async () => {
    const created = await api.patients.create(admin(), base(), crypto.randomUUID());
    const detail = await api.patients.open(admin(), created.id);
    expect(detail).toMatchObject({
      email: "visitor@example.invalid",
      messageLanguage: "en",
      notificationsOptOut: true,
    });
  });

  it("empty email and language are stored as none / clinic default", async () => {
    const created = await api.patients.create(
      admin(),
      { ...base(), email: "", messageLanguage: "", notificationsOptOut: false },
      crypto.randomUUID(),
    );
    const detail = await api.patients.open(admin(), created.id);
    expect(detail).toMatchObject({ email: null, messageLanguage: null, notificationsOptOut: false });
  });

  it("NEGATIVE: a bad email is refused", async () => {
    await expect(
      api.patients.create(admin(), { ...base(), email: "not-an-email" }, crypto.randomUUID()),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("the email never reaches the audit log", async () => {
    await api.patients.create(admin(), base(), crypto.randomUUID());
    expect(JSON.stringify(getState().clinicAudit)).not.toContain("visitor@example.invalid");
  });
});
