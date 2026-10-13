import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NOTIFICATION_SETTINGS } from "@eyadex/contracts/notifications";
import { WHATSAPP_RISK_VERSION } from "@eyadex/contracts/whatsapp";
import { api, as, clinicIdAt, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
import {
  MOCK_DELIVERED_DELAY_MS,
  MOCK_READ_DELAY_MS,
  MOCK_SEND_DELAY_MS,
} from "@/shared/api/mock/mock-notification-queue";

const admin = as("clinic_admin");
const IDS = { wabaId: "300000000000003", phoneNumberId: "400000000000004" };

beforeEach(() => {
  resetMockData();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("embedded signup (mock)", () => {
  it("answers fixed demo ids for signup-config", async () => {
    expect(await api.whatsapp.signupConfig(admin)).toMatchObject({ graphVersion: "v21.0" });
  });

  it.each([
    ["two_step", { phoneNumberId: "meta_two_step_enabled" }],
    ["used", { phoneNumberId: "number_in_use" }],
    ["expired", { code: "meta_code_invalid" }],
  ])("code %s is refused", async (code, details) => {
    await expect(api.whatsapp.embeddedSignup(admin, { code, ...IDS })).rejects.toMatchObject({
      code: "validation",
      details,
    });
  });

  it("any other code connects with 0000", async () => {
    const view = await api.whatsapp.embeddedSignup(admin, { code: "demo", ...IDS });
    expect(view).toMatchObject({
      transport: "coexistence",
      status: "connected",
      phoneLast4: "0000",
    });
    expect(view.phoneNumberId).toBe(IDS.phoneNumberId);
    expect(getState().clinicAudit[0]?.after).toMatchObject({ via: "embedded_signup" });
  });

  it("NEGATIVE: a doctor may not sign up", async () => {
    await expect(
      api.whatsapp.embeddedSignup(as("doctor"), { code: "demo", ...IDS }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/forbidden|not_allowed/) });
  });

  it("signup-config requires view, while signup requires update", async () => {
    const db = getState();
    const member = db.members.find((m) => m.clinicId === admin.clinicId)!;
    db.roles.find((r) => r.id === member.roleId)!.permissions = ["view:clinic_settings:clinic"];
    const viewer = { ...admin, memberId: member.id };
    await expect(api.whatsapp.signupConfig(viewer)).resolves.toHaveProperty("appId");
    await expect(
      api.whatsapp.embeddedSignup(viewer, { code: "demo", ...IDS }),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("cancel leaves the channel and audit unchanged", async () => {
    const before = await api.whatsapp.channel(admin);
    const audit = [...getState().clinicAudit];
    expect(await api.whatsapp.embeddedSignup(admin, { code: "cancel", ...IDS })).toEqual(before);
    expect(await api.whatsapp.channel(admin)).toEqual(before);
    expect(getState().clinicAudit).toEqual(audit);
  });

  it.each(["connected", "disconnected"] as const)(
    "both saves refuse another clinic's %s number without changing state",
    async (status) => {
      await api.whatsapp.embeddedSignup(admin, { code: "demo", ...IDS });
      if (status === "disconnected") await api.whatsapp.disconnect(admin);
      const other = as("clinic_admin", 1);
      const before = await api.whatsapp.channel(other);
      const audit = [...getState().clinicAudit];
      const held = await api.whatsapp.channel(admin);
      for (const call of [
        () => api.whatsapp.embeddedSignup(other, { code: "demo", ...IDS }),
        () =>
          api.whatsapp.saveCoexistence(other, {
            accessToken: crypto.randomUUID(),
            phoneNumberId: IDS.phoneNumberId,
            businessAccountId: IDS.wabaId,
            templates: held.templates,
          }),
      ]) {
        await expect(call()).rejects.toMatchObject({
          code: "validation",
          details: { phoneNumberId: "number_in_use" },
        });
        expect(await api.whatsapp.channel(other)).toEqual(before);
        expect(getState().clinicAudit).toEqual(audit);
      }
    },
  );
});

describe("delivered/read receipts (mock)", () => {
  async function cancelFor(lastDigit: string) {
    await api.whatsapp.connect(admin, { acceptRisk: true, riskVersion: WHATSAPP_RISK_VERSION });
    vi.advanceTimersByTime(6000);
    await api.whatsapp.qr(admin);
    await api.notifications.updateSettings(admin, {
      emailEnabled: true,
      whatsappEnabled: true,
      messages: DEFAULT_NOTIFICATION_SETTINGS.messages,
    });
    const s = getState();
    const appt = s.appointments.find((a) => a.clinicId === clinicIdAt(0) && a.status === "booked")!;
    s.patients.find((p) => p.id === appt.patientId)!.phone = `+0000000000${lastDigit}`;
    await api.appointments.cancel(admin, appt.id, { reason: "other", note: null });
    vi.advanceTimersByTime(MOCK_SEND_DELAY_MS);
    const wa = async () =>
      (await api.notifications.appointmentHistory(admin, appt.id)).items.find(
        (i) => i.channel === "whatsapp",
      )!;
    return wa;
  }

  it("a sent row is delivered after 3 s and read after 6 s", async () => {
    const wa = await cancelFor("1");
    expect(await wa()).toMatchObject({ status: "sent", deliveredAt: null, readAt: null });
    vi.advanceTimersByTime(MOCK_DELIVERED_DELAY_MS);
    expect((await wa()).deliveredAt).not.toBeNull();
    expect((await wa()).readAt).toBeNull();
    vi.advanceTimersByTime(MOCK_READ_DELAY_MS - MOCK_DELIVERED_DELAY_MS);
    expect((await wa()).readAt).not.toBeNull();
  });

  it("a phone ending in 9 fails with whatsapp_two_step", async () => {
    const wa = await cancelFor("9");
    expect(await wa()).toMatchObject({
      status: "failed",
      failureReason: "whatsapp_two_step",
      route: null,
      sentAt: null,
    });
  });

  it("a delivery rejection keeps the accepted route and time", async () => {
    const wa = await cancelFor("0");
    expect(await wa()).toMatchObject({
      status: "failed",
      failureReason: "delivery_rejected",
      route: "evolution",
      sentAt: expect.any(String),
    });
  });
});
