import { beforeEach, describe, expect, it } from "vitest";
import { api, as, getState, PLATFORM, resetMockData } from "@/shared/api/mock/mock-test-kit";

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
    a.expiresAt = new Date(Date.now() + 5 * DAY).toISOString();
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
    const { clinic } = await api.platform.createClinic(
      { kind: "platform_admin", clinicId: null, memberId: null },
      {
        nameAr: "عيادة",
        nameEn: "Trial Clinic",
        specialty: "general",
        defaultLanguage: "ar",
        timezone: "Asia/Kuwait",
        slug: "trial-clinic",
        adminName: "Admin Person",
        adminEmail: "admin-trial@example.com",
      },
    );
    const days = (new Date(clinic.expiresAt).getTime() - Date.now()) / DAY;
    expect(Math.round(days)).toBe(7);
  });
});

describe("platform access follows the signed-in account", () => {
  beforeEach(() => resetMockData());

  it("refuses every platform API once the account is deactivated, without switching identity", async () => {
    const db = getState();
    const founder = [...db.platformAccounts].sort((x, y) =>
      x.createdAt.localeCompare(y.createdAt),
    )[0];
    if (!founder) throw new Error("seed");
    // A second active account exists, so the last-account rule does not block this.
    db.platformAccounts.push({
      id: crypto.randomUUID(),
      fullName: "Second Admin",
      email: "second@example.com",
      status: "active",
      joinedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    await api.platformTeam.deactivate(PLATFORM, founder.id);
    const clinicId = db.clinics[0]?.id ?? "";
    for (const call of [
      api.platform.listClinics(PLATFORM, {
        cursor: null,
        limit: 10,
        search: "",
        status: null,
        specialty: null,
      }),
      api.platform.getClinic(PLATFORM, clinicId),
      api.platform.setClinicFeature(PLATFORM, clinicId, "patients", false),
      api.audit.platformClinicOptions(PLATFORM),
    ]) {
      await expect(call).rejects.toMatchObject({ code: "account_disabled" });
    }
  });

  it("lets the surviving team account sign in after the founder is deactivated", async () => {
    const db = getState();
    const second = {
      id: crypto.randomUUID(),
      fullName: "Second Admin",
      email: "second@example.com",
      status: "active" as const,
      joinedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    db.platformAccounts.push(second);
    const founder = (await api.session.listLoginPlatformAccounts())[0];
    if (!founder) throw new Error("seed");
    await api.platformTeam.deactivate(PLATFORM, founder.memberId);
    const accounts = await api.session.listLoginPlatformAccounts();
    expect(accounts.find((a) => a.memberId === second.id)?.status).toBe("active");
    const pinned = { kind: "platform_admin" as const, clinicId: null, memberId: second.id };
    const ctx = await api.session.getContext(pinned);
    expect(ctx.user.email).toBe(second.email);
    await expect(api.platform.getClinic(pinned, db.clinics[0]?.id ?? "")).resolves.toBeDefined();
  });
  it("activates an invited platform account when it accepts, once", async () => {
    const invited = await api.platformTeam.invite(PLATFORM, {
      fullName: "New Operator",
      email: "new.operator@example.com",
    });
    const pinned = { kind: "platform_admin" as const, clinicId: null, memberId: invited.id };
    await expect(api.session.getContext(pinned)).rejects.toMatchObject({
      code: "account_disabled",
    });
    await api.session.acceptPlatformInvitation(invited.id);
    expect((await api.session.getContext(pinned)).user.email).toBe("new.operator@example.com");
    await expect(api.session.acceptPlatformInvitation(invited.id)).rejects.toMatchObject({
      code: "invitation_used",
    });
    const audit = await api.audit.platformList(pinned, {
      cursor: null,
      limit: 50,
      actor: "",
      action: "platform_account.joined",
      from: null,
      to: null,
      entity: null,
      source: null,
      clinicId: null,
    });
    expect(audit.items[0]?.entityId).toBe(invited.id);
  });
});
