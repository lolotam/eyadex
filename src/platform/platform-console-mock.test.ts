import { beforeEach, describe, expect, it } from "vitest";
import { api, as, getState, PLATFORM, resetMockData } from "@/audit/audit-test-kit";

const DAY = 24 * 60 * 60 * 1000;
const PATIENT_FIELDS = /patient|fileNumber|civilId|birthDate|phone|gender/i;

describe("platform overview (stories 3-4)", () => {
  beforeEach(() => resetMockData());

  it("is platform admin only", async () => {
    await expect(api.platformOverview.get(as("clinic_admin"))).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("computes expired at read time without storing it", async () => {
    const clinic = getState().clinics[0];
    if (!clinic) throw new Error("no clinic");
    clinic.status = "active";
    clinic.expiresAt = new Date(Date.now() - DAY).toISOString();
    const { counts } = await api.platformOverview.get(PLATFORM);
    const db = getState();
    expect(counts.expired).toBeGreaterThanOrEqual(1);
    expect(Object.values(counts).reduce((a, b) => a + (b ?? 0), 0)).toBe(db.clinics.length);
    expect(clinic.status).toBe("active");
  });

  it("lists clinics expiring within the alert setting", async () => {
    const [a, b] = getState().clinics;
    if (!a || !b) throw new Error("no clinics");
    a.status = "active";
    b.status = "active";
    a.expiresAt = new Date(Date.now() + 10 * DAY).toISOString();
    b.expiresAt = new Date(Date.now() + 25 * DAY).toISOString();
    let overview = await api.platformOverview.get(PLATFORM);
    expect(overview.expiringSoon.map((c) => c.id)).toContain(a.id);
    expect(overview.expiringSoon.map((c) => c.id)).not.toContain(b.id);
    await api.platformSettings.update(PLATFORM, {
      ...getState().platformSettings,
      alertDaysBeforeExpiry: 30,
    });
    overview = await api.platformOverview.get(PLATFORM);
    expect(overview.expiringSoon.map((c) => c.id)).toContain(b.id);
  });

  it("returns no patient fields", async () => {
    const overview = await api.platformOverview.get(PLATFORM);
    expect(JSON.stringify(overview)).not.toMatch(PATIENT_FIELDS);
  });
});

describe("platform team (stories 24-25)", () => {
  beforeEach(() => resetMockData());

  it("is platform admin only", async () => {
    await expect(api.platformTeam.list(as("clinic_admin"))).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("refuses to deactivate the last active account", async () => {
    const team = await api.platformTeam.list(PLATFORM);
    const active = team.filter((a) => a.status === "active");
    expect(active.length).toBe(2);
    const [first, second] = active;
    if (!first || !second) throw new Error("seed");
    await api.platformTeam.deactivate(PLATFORM, second.id);
    await expect(api.platformTeam.deactivate(PLATFORM, first.id)).rejects.toMatchObject({
      code: "last_active_platform_account",
    });
  });

  it("applies one email = one account across clinics and the platform", async () => {
    const member = getState().members[0];
    if (!member) throw new Error("seed");
    await expect(
      api.platformTeam.invite(PLATFORM, { fullName: "Dup", email: member.email }),
    ).rejects.toMatchObject({ code: "email_taken" });
    await api.platformTeam.invite(PLATFORM, { fullName: "New Member", email: "new@eyadex.com" });
    await expect(
      api.platformTeam.invite(PLATFORM, { fullName: "Again", email: "NEW@eyadex.com" }),
    ).rejects.toMatchObject({ code: "email_taken" });
  });

  it("audits invite, deactivate and reactivate with before/after", async () => {
    const invited = await api.platformTeam.invite(PLATFORM, {
      fullName: "New Member",
      email: "new@eyadex.com",
    });
    await api.platformTeam.deactivate(PLATFORM, invited.id);
    const back = await api.platformTeam.reactivate(PLATFORM, invited.id);
    expect(back.status).toBe("invited");
    const [re, de, inv] = getState().platformAudit;
    expect(inv).toMatchObject({ action: "platform_account.invited", before: null });
    expect(inv?.after).toMatchObject({ email: "new@eyadex.com", status: "invited" });
    expect(de?.before).toMatchObject({ status: "invited" });
    expect(de?.after).toMatchObject({ status: "deactivated" });
    expect(re).toMatchObject({ action: "platform_account.reactivated", entityId: invited.id });
  });
});

describe("platform settings (story 26)", () => {
  beforeEach(() => resetMockData());

  it("enforces the bounds", async () => {
    const base = getState().platformSettings;
    const bad = [
      { ...base, defaultTrialDays: 0 },
      { ...base, defaultTrialDays: 91 },
      { ...base, alertDaysBeforeExpiry: 0 },
      { ...base, alertDaysBeforeExpiry: 61 },
      { ...base, emailSenderName: " A " },
      { ...base, emailSenderName: "x".repeat(61) },
    ];
    for (const input of bad)
      await expect(api.platformSettings.update(PLATFORM, input)).rejects.toMatchObject({
        code: "validation",
      });
    const ok = {
      defaultTrialDays: 90,
      alertDaysBeforeExpiry: 60,
      emailSenderName: "  Eyadex Team ",
    };
    expect((await api.platformSettings.update(PLATFORM, ok)).emailSenderName).toBe("Eyadex Team");
  });

  it("rejects non-platform callers before validating", async () => {
    await expect(
      api.platformSettings.update(as("clinic_admin"), {
        defaultTrialDays: 0,
        alertDaysBeforeExpiry: 0,
        emailSenderName: "",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("audits before/after and drives new trials", async () => {
    const before = { ...getState().platformSettings };
    await api.platformSettings.update(PLATFORM, { ...before, defaultTrialDays: 7 });
    const entry = getState().platformAudit[0];
    expect(entry).toMatchObject({ action: "platform.settings_updated", before });
    expect(entry?.after).toMatchObject({ defaultTrialDays: 7 });
    const { clinic } = await api.platform.createClinic({
      nameAr: "عيادة",
      nameEn: "Trial Clinic",
      specialty: "general",
      defaultLanguage: "ar",
      timezone: "Asia/Kuwait",
      slug: "trial-clinic",
      adminName: "Admin Person",
      adminEmail: "admin-trial@example.com",
    });
    const days = (new Date(clinic.expiresAt).getTime() - Date.now()) / DAY;
    expect(Math.round(days)).toBe(7);
  });
});
