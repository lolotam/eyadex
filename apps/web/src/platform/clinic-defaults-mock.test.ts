import { beforeEach, describe, expect, it } from "vitest";
import type { CreateClinicInput } from "@eyadex/contracts/clinics";
import { api, getState, PLATFORM, resetMockData } from "@/shared/api/mock/mock-test-kit";

// ADR-0020 amendment (2026-10-09): new-clinic limits and modules are platform settings the create
// form starts from; a created clinic keeps what the form sent. The mock answers as the API does.

const clinic = (over: Partial<CreateClinicInput> = {}): CreateClinicInput => ({
  nameAr: "عيادة",
  nameEn: "Defaults Clinic",
  slug: "defaults-clinic",
  specialty: "general",
  defaultLanguage: "ar",
  timezone: "Asia/Kuwait",
  adminName: "Admin Person",
  adminEmail: "defaults.admin@example.com",
  maxUsers: 7,
  maxBranches: 4,
  modules: { patients: false, appointments: false, medical: false, finance: false },
  ...over,
});

describe("new-clinic defaults in the platform settings", () => {
  beforeEach(() => resetMockData());

  it("seeds 10 users, 3 branches and every module on (medical since its release)", async () => {
    expect(await api.platformSettings.get(PLATFORM)).toMatchObject({
      defaultMaxUsers: 10,
      defaultMaxBranches: 3,
      defaultModules: { patients: true, appointments: true, medical: true, finance: false },
    });
  });

  it("saves and audits them", async () => {
    const before = await api.platformSettings.get(PLATFORM);
    const next = { ...before, defaultMaxUsers: 25, defaultMaxBranches: 5 };
    await api.platformSettings.update(PLATFORM, {
      ...next,
      defaultModules: { patients: false, appointments: false, medical: false, finance: false },
    });
    expect(await api.platformSettings.get(PLATFORM)).toMatchObject({
      defaultMaxUsers: 25,
      defaultMaxBranches: 5,
      defaultModules: { patients: false, appointments: false, medical: false, finance: false },
    });
    expect(getState().platformAudit[0]?.after).toMatchObject({
      defaultMaxUsers: 25,
      defaultModules: { patients: false, appointments: false, medical: false, finance: false },
    });
  });

  it("reads incoherent stored defaults, but refuses saving them without changes or audit", async () => {
    getState().platformSettings.defaultModules = {
      patients: false,
      appointments: true,
      medical: true,
      finance: false,
    };
    const before = structuredClone(getState());
    const stored = await api.platformSettings.get(PLATFORM);
    expect(stored).toEqual(before.platformSettings);
    await expect(api.platformSettings.update(PLATFORM, stored)).rejects.toMatchObject({
      code: "validation",
    });
    expect(getState()).toEqual(before);
  });

  it("NEGATIVE: refuses out-of-range limits and a missing, extra or non-boolean module", async () => {
    const base = await api.platformSettings.get(PLATFORM);
    const bad: unknown[] = [
      { ...base, defaultMaxUsers: 0 },
      { ...base, defaultMaxUsers: 1001 },
      { ...base, defaultMaxBranches: 101 },
      { ...base, defaultMaxBranches: 1.5 },
      { ...base, defaultModules: {} },
      { ...base, defaultModules: { patients: true, billing: true } },
      { ...base, defaultModules: { patients: "yes" } },
    ];
    for (const input of bad)
      await expect(
        api.platformSettings.update(PLATFORM, input as typeof base),
      ).rejects.toMatchObject({ code: "validation" });
    expect(await api.platformSettings.get(PLATFORM)).toEqual(base);
  });
});

describe("a new clinic keeps the form's limits and modules", () => {
  beforeEach(() => resetMockData());

  it("uses the values sent, not the platform defaults", async () => {
    const { clinic: created } = await api.platform.createClinic(
      PLATFORM,
      clinic(),
      crypto.randomUUID(),
    );
    const detail = await api.platform.getClinic(PLATFORM, created.id);
    expect(detail).toMatchObject({
      maxUsers: 7,
      maxBranches: 4,
      features: { patients: false, appointments: false, medical: false, finance: false },
    });
  });

  it("NEGATIVE: a create without limits or modules is refused and creates nothing", async () => {
    const count = getState().clinics.length;
    for (const field of ["maxUsers", "maxBranches", "modules"] as const) {
      const { [field]: _drop, ...missing } = clinic({ slug: `missing-${field.toLowerCase()}` });
      void _drop;
      await expect(
        api.platform.createClinic(PLATFORM, missing as CreateClinicInput, crypto.randomUUID()),
      ).rejects.toBeDefined();
    }
    expect(getState().clinics.length).toBe(count);
  });

  it("NEGATIVE: medical without patients creates no clinic, invitation or audit", async () => {
    const before = structuredClone(getState());
    await expect(
      api.platform.createClinic(
        PLATFORM,
        clinic({ modules: { patients: false, appointments: true, medical: true, finance: false } }),
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "validation" });
    expect(getState()).toEqual(before);
  });

  // PR #78 review: the finance fields were checked after the clinic was pushed into the store.
  it("NEGATIVE: an unsupported currency creates no clinic", async () => {
    const count = getState().clinics.length;
    const bad = { ...clinic({ slug: "bad-currency" }), currency: "XXX" } as CreateClinicInput;
    await expect(
      api.platform.createClinic(PLATFORM, bad, crypto.randomUUID()),
    ).rejects.toBeDefined();
    expect(getState().clinics.length).toBe(count);
  });
});
