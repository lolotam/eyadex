import { createClinicRequestSchema } from "@eyadex/contracts/onboarding";
import {
  platformClinicDetailSchema,
  platformClinicListResponseSchema,
} from "@eyadex/contracts/platform-clinics";
import { DEFAULT_PLATFORM_SETTINGS } from "@eyadex/contracts/platform";
import {
  platformAccountResponseSchema,
  platformMeResponseSchema,
  platformOverviewResponseSchema,
  platformSettingsRequestSchema,
  platformSettingsResponseSchema,
  platformTeamListResponseSchema,
} from "@eyadex/contracts/platform-console";
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
      defaultLanguage: "ar",
      timezone: "Asia/Kuwait",
      createdAt: "2026-01-01T00:00:00.000Z",
      modules: { patients: true, appointments: true },
      usage: { users: { used: 1, max: 2 }, branches: { used: 1, max: 1 } },
    };
    expect(platformClinicDetailSchema.safeParse(base).success).toBe(true);
    expect(platformClinicDetailSchema.safeParse({ ...base, patientCount: 3 }).success).toBe(false);
    const usage = { ...base.usage, patients: { used: 3, max: 9 } };
    expect(platformClinicDetailSchema.safeParse({ ...base, usage }).success).toBe(false);
    const page = { items: [base], nextCursor: null, total: 1 };
    expect(platformClinicListResponseSchema.safeParse(page).success).toBe(true);
    const leaky = { ...page, items: [{ ...base, patientCount: 3 }] };
    expect(platformClinicListResponseSchema.safeParse(leaky).success).toBe(false);
    expect(platformClinicListResponseSchema.safeParse({ ...page, patients: 3 }).success).toBe(
      false,
    );
  });
});

const request = {
  nameAr: "عيادة",
  nameEn: "Clinic",
  slug: "contract-clinic",
  specialty: "general",
  defaultLanguage: "ar",
  timezone: "Asia/Kuwait",
  status: "trial",
  maxUsers: 5,
  maxBranches: 2,
  modules: { patients: true, appointments: true },
  admin: { fullName: "Test Admin", email: "admin@example.test" },
};

describe("create clinic: at most one expiry input (neither = the platform default, ADR-0020)", () => {
  it("accepts trialDays alone, expiresAt alone, or neither", () => {
    expect(createClinicRequestSchema.safeParse({ ...request, trialDays: 14 }).success).toBe(true);
    expect(createClinicRequestSchema.safeParse(request).success).toBe(true);
    const at = { ...request, expiresAt: "2099-01-01T00:00:00Z" };
    expect(createClinicRequestSchema.safeParse(at).success).toBe(true);
  });
  it("NEGATIVE: refuses both, and a trial outside 1–365", () => {
    const both = { ...request, trialDays: 14, expiresAt: "2099-01-01T00:00:00Z" };
    expect(createClinicRequestSchema.safeParse(both).success).toBe(false);
    expect(createClinicRequestSchema.safeParse({ ...request, trialDays: 366 }).success).toBe(false);
  });
});

// ADR-0020: the platform console's answers are strict too, so a patient field can never ride along.
describe("platform console contracts (PLAT-02)", () => {
  const account = {
    id: "0190a000-0000-7000-8000-000000000001",
    fullName: "Member",
    email: "m@example.test",
    status: "active",
    joinedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const overview = {
    counts: { trial: 1, active: 1, suspended: 0, expired: 2 },
    alertDaysBeforeExpiry: 7,
    expiringSoon: [
      {
        id: account.id,
        nameAr: "ع",
        nameEn: "A",
        status: "trial",
        expiresAt: "2099-01-01T00:00:00.000Z",
        daysLeft: 3,
      },
    ],
  };
  const cases = [
    [platformOverviewResponseSchema, overview],
    [platformMeResponseSchema, { id: account.id, fullName: "M", email: "m@example.test" }],
    [platformAccountResponseSchema, account],
    [platformTeamListResponseSchema, { items: [account], nextCursor: null, total: 1 }],
    [
      platformSettingsResponseSchema,
      {
        defaultTrialDays: 14,
        alertDaysBeforeExpiry: 7,
        emailSenderName: "Eyadex",
        defaultMaxUsers: 10,
        defaultMaxBranches: 3,
        defaultModules: { patients: true, appointments: true },
      },
    ],
  ] as const;

  it.each(cases)(
    "accepts its own shape and NEGATIVE: refuses an extra patient field",
    (schema, ok) => {
      expect(schema.safeParse(ok).success).toBe(true);
      expect(schema.safeParse({ ...ok, patientCount: 3 }).success).toBe(false);
    },
  );

  it("NEGATIVE: an expiring clinic or a team member carrying a patient field is refused", () => {
    const leakyClinic = { ...overview.expiringSoon[0], patients: 4 };
    expect(
      platformOverviewResponseSchema.safeParse({ ...overview, expiringSoon: [leakyClinic] })
        .success,
    ).toBe(false);
    const leakyTeam = { items: [{ ...account, civilId: "x" }], nextCursor: null, total: 1 };
    expect(platformTeamListResponseSchema.safeParse(leakyTeam).success).toBe(false);
  });
});

// ADR-0020 amendment (2026-10-09): a platform default is always a create the API accepts.
describe("new-clinic defaults share the create request's bounds", () => {
  const settings = (over: object) =>
    platformSettingsRequestSchema.safeParse({ ...DEFAULT_PLATFORM_SETTINGS, ...over }).success;
  const create = (over: object) =>
    createClinicRequestSchema.safeParse({ ...request, ...over }).success;

  it.each([0, 1, 1000, 1001])("users %i: the setting and the create agree", (n) => {
    expect(settings({ defaultMaxUsers: n })).toBe(create({ maxUsers: n }));
  });
  it.each([0, 1, 100, 101])("branches %i: the setting and the create agree", (n) => {
    expect(settings({ defaultMaxBranches: n })).toBe(create({ maxBranches: n }));
  });
  it("NEGATIVE: a missing default, a module flag that is not a boolean, a missing or an unknown module is refused", () => {
    const { defaultModules: _drop, ...missing } = DEFAULT_PLATFORM_SETTINGS;
    void _drop;
    expect(platformSettingsRequestSchema.safeParse(missing).success).toBe(false);
    expect(settings({ defaultModules: { patients: "true" } })).toBe(false);
    expect(settings({ defaultModules: {} })).toBe(false);
    expect(settings({ defaultModules: { patients: true, billing: true } })).toBe(false);
  });
  it("the default modules and a create request's modules have the same keys", () => {
    for (const modules of [
      {},
      { patients: true, appointments: true },
      { patients: true, billing: false },
    ]) {
      expect(settings({ defaultModules: modules })).toBe(create({ modules }));
    }
  });
});
