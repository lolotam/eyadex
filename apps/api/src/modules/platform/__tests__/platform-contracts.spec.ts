import { platformClinicDetailSchema } from "@eyadex/contracts/platform-clinics";
import { describe, expect, it } from "vitest";

// PLAT-02 at the schema: the platform detail has no patient field, and a strict schema refuses one.
describe("platform clinic detail contract", () => {
  it("has no key that names patients other than the module flag", () => {
    const keys = [
      ...Object.keys(platformClinicDetailSchema.shape),
      ...Object.keys(platformClinicDetailSchema.shape.usage.shape),
    ];
    expect(keys.some((k) => /patient|civil|phone|file/i.test(k))).toBe(false);
    expect(Object.keys(platformClinicDetailSchema.shape.usage.shape)).toEqual([
      "users",
      "branches",
    ]);
  });

  it("NEGATIVE: a response with a patient count is refused", () => {
    const base = {
      id: "0190a000-0000-7000-8000-000000000001",
      slug: "a",
      nameAr: "ع",
      nameEn: "A",
      specialty: "general",
      status: "active",
      access: "allowed",
      expiresAt: "2099-01-01T00:00:00.000Z",
      modules: { patients: true },
      usage: { users: { used: 1, max: 2 }, branches: { used: 1, max: 1 } },
    };
    expect(platformClinicDetailSchema.safeParse(base).success).toBe(true);
    expect(platformClinicDetailSchema.safeParse({ ...base, patientCount: 3 }).success).toBe(false);
    const usage = { ...base.usage, patients: { used: 3, max: 9 } };
    expect(platformClinicDetailSchema.safeParse({ ...base, usage }).success).toBe(false);
  });
});
