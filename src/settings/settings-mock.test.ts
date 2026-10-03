import { beforeEach, describe, expect, it } from "vitest";
import { expiryAlertDays } from "@contracts/platform";
import { api, as, getState, PLATFORM, resetMockData } from "@/shared/api/mock/mock-test-kit";

const DAY = 24 * 60 * 60 * 1000;
const SETTINGS = {
  nameAr: "عيادة جديدة",
  nameEn: "New Clinic",
  defaultLanguage: "en" as const,
  timezone: "Asia/Dubai",
};

describe("clinic settings (story 55)", () => {
  beforeEach(() => resetMockData());

  it("needs view and update permissions, checked before validation", async () => {
    await expect(api.clinicSettings.get(as("doctor"))).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      api.clinicSettings.update(as("doctor"), { ...SETTINGS, timezone: "Mars/Base" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(api.clinicSettings.get(PLATFORM)).rejects.toMatchObject({ code: "forbidden" });
    expect((await api.clinicSettings.get(as("clinic_admin"))).slug).toBeTruthy();
  });

  it("rejects unsupported time zones", async () => {
    await expect(
      api.clinicSettings.update(as("clinic_admin"), { ...SETTINGS, timezone: "Europe/Paris" }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("writes clinic.settings_updated with before/after, visible to the platform", async () => {
    const before = await api.clinicSettings.get(as("clinic_admin"));
    await api.clinicSettings.update(as("clinic_admin"), SETTINGS);
    const entry = getState().clinicAudit[0];
    expect(entry).toMatchObject({
      action: "clinic.settings_updated",
      entity: "clinic",
      category: "administrative",
    });
    expect(entry?.before).toMatchObject({ nameEn: before.nameEn, timezone: before.timezone });
    expect(entry?.after).toMatchObject({ nameEn: "New Clinic", timezone: "Asia/Dubai" });
    const platform = await api.audit.platformList(PLATFORM, {
      cursor: null,
      limit: 100,
      actor: "",
      action: "clinic.settings_updated",
      entity: null,
      source: null,
      clinicId: null,
      from: null,
      to: null,
    });
    expect(platform.items).toHaveLength(1);
  });
});

describe("my account (story 64)", () => {
  beforeEach(() => resetMockData());

  it("lets any active member change their own name and language, audited", async () => {
    const saved = await api.account.update(as("doctor"), {
      fullName: "Dr. Renamed",
      preferredLanguage: "en",
    });
    expect(saved).toMatchObject({ fullName: "Dr. Renamed", preferredLanguage: "en" });
    const entry = getState().clinicAudit[0];
    expect(entry).toMatchObject({ action: "user.profile_updated", entity: "user" });
    expect(entry?.after).toMatchObject({ fullName: "Dr. Renamed", preferredLanguage: "en" });
    expect(entry?.before).toHaveProperty("fullName");
  });

  it("rejects a too-short name and the platform persona", async () => {
    await expect(
      api.account.update(as("doctor"), { fullName: "A", preferredLanguage: "ar" }),
    ).rejects.toMatchObject({ code: "validation" });
    await expect(api.account.get(PLATFORM)).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("expiry banner (story 30)", () => {
  beforeEach(() => resetMockData());

  it("shows within the alert window only", () => {
    const now = Date.now();
    const at = (days: number) => new Date(now + days * DAY).toISOString();
    expect(expiryAlertDays(at(14), 14, now)).toBe(14);
    expect(expiryAlertDays(at(15), 14, now)).toBeNull();
    expect(expiryAlertDays(at(0.5), 14, now)).toBe(1);
    expect(expiryAlertDays(at(-1), 14, now)).toBeNull();
  });

  it("follows the platform setting in the session", async () => {
    const db = getState();
    const clinic = db.clinics[0];
    if (!clinic) throw new Error("no clinic");
    clinic.status = "active";
    clinic.expiresAt = new Date(Date.now() + 20 * DAY).toISOString();
    expect((await api.session.getContext(as("doctor"))).expiresInDays).toBeNull();
    await api.platformSettings.update(PLATFORM, {
      ...db.platformSettings,
      alertDaysBeforeExpiry: 30,
    });
    expect((await api.session.getContext(as("doctor"))).expiresInDays).toBe(20);
    clinic.status = "suspended";
    expect((await api.session.getContext(as("doctor"))).expiresInDays).toBeNull();
  });
});
