import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NOTIFICATION_SETTINGS } from "@eyadex/contracts/notifications";
import { WHATSAPP_RISK_VERSION } from "@eyadex/contracts/whatsapp";
import { api, as, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { isWhatsappUnavailable } from "@/shared/api/api-error";
import { MOCK_SCAN_DELAY_MS } from "@/shared/api/mock/mock-whatsapp-state";
import { queueNotification, MOCK_SEND_DELAY_MS } from "@/shared/api/mock/mock-notification-queue";
import { notificationState } from "@/shared/api/mock/mock-notification-state";

const admin = as("clinic_admin");
const ACCEPT = { acceptRisk: true, riskVersion: WHATSAPP_RISK_VERSION } as const;
const TOKEN = "fictional-token-0123456789";
const coexistence = (extra: object = {}) => ({
  phoneNumberId: "100000000001",
  businessAccountId: "200000000002",
  templates: Object.fromEntries(
    Object.keys(DEFAULT_NOTIFICATION_SETTINGS.messages).map((k) => [k, null]),
  ) as never,
  ...extra,
});

beforeEach(() => {
  resetMockData();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

async function connectAndScan() {
  await api.whatsapp.connect(admin, ACCEPT);
  vi.advanceTimersByTime(MOCK_SCAN_DELAY_MS);
  return api.whatsapp.qr(admin);
}

describe("whatsapp mock", () => {
  it("risk gate: connect without accepting the risk is refused", async () => {
    await expect(
      api.whatsapp.connect(admin, { acceptRisk: false, riskVersion: 1 } as never),
    ).rejects.toMatchObject({ code: "validation" });
    expect((await api.whatsapp.channel(admin)).riskAcceptedAt).toBeNull();
  });

  it("records the risk once, answers a QR, then connects with 0000 after 6 s", async () => {
    const first = await api.whatsapp.connect(admin, ACCEPT);
    expect(first.status).toBe("pending");
    expect(first.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    const accepted = (await api.whatsapp.channel(admin)).riskAcceptedAt;
    vi.advanceTimersByTime(MOCK_SCAN_DELAY_MS - 1);
    expect((await api.whatsapp.qr(admin)).status).toBe("pending");
    vi.advanceTimersByTime(1);
    expect(await api.whatsapp.qr(admin)).toEqual({ status: "connected", qrDataUrl: null });
    const view = await api.whatsapp.channel(admin);
    expect(view.phoneLast4).toBe("0000");
    expect(view.riskAcceptedAt).toBe(accepted);
  });

  it("disconnect sets the channel back to disconnected", async () => {
    await connectAndScan();
    await api.whatsapp.disconnect(admin);
    const view = await api.whatsapp.channel(admin);
    expect(view.status).toBe("disconnected");
    expect(view.phoneLast4).toBeNull();
  });

  it("refuses changes without update:clinic_settings", async () => {
    await expect(api.whatsapp.connect(as("doctor"), ACCEPT)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("coexistence: the token is required first, write-only, and kept when omitted", async () => {
    await expect(api.whatsapp.saveCoexistence(admin, coexistence())).rejects.toMatchObject({
      code: "validation",
    });
    await api.whatsapp.saveCoexistence(admin, coexistence({ accessToken: TOKEN }));
    await api.whatsapp.saveCoexistence(admin, coexistence());
    const view = await api.whatsapp.channel(admin);
    expect(view.hasCredentials).toBe(true);
    expect(JSON.stringify(view)).not.toContain(TOKEN);
    const clinicId = getState().clinics[0]!.id;
    expect(getState().whatsapp!.channels[clinicId]!.accessToken).toBe(TOKEN);
  });

  it("answers unavailable when the server has no WhatsApp", async () => {
    getState().whatsapp = { channels: {}, unavailable: true };
    const error = await api.whatsapp.connect(admin, ACCEPT).catch((e) => e);
    expect(isWhatsappUnavailable(error)).toBe(true);
  });

  it("refuses switching WhatsApp on while not connected, allows it once connected", async () => {
    const on = { ...DEFAULT_NOTIFICATION_SETTINGS, whatsappEnabled: true };
    await expect(api.notifications.updateSettings(admin, on)).rejects.toMatchObject({
      code: "validation",
      details: { whatsappEnabled: "whatsapp_not_connected" },
    });
    await connectAndScan();
    await expect(api.notifications.updateSettings(admin, on)).resolves.toMatchObject(on);
  });
});

describe("whatsapp queueing", () => {
  const subject = () => {
    const db = getState();
    const p = db.patients.find((x) => x.clinicId === db.clinics[0]!.id)!;
    return {
      clinicId: p.clinicId,
      patientId: p.id,
      kind: "prescription" as const,
      subjectType: "visit" as const,
      subjectId: "visit-1",
      subjectAt: null,
    };
  };
  const rows = () => notificationState(getState()).ledger.filter((r) => r.channel === "whatsapp");

  it("queues nothing on WhatsApp while it is off", () => {
    queueNotification(getState(), subject());
    expect(rows()).toEqual([]);
  });

  it("sends through evolution when enabled and connected", async () => {
    await connectAndScan();
    await api.notifications.updateSettings(admin, {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      whatsappEnabled: true,
    });
    queueNotification(getState(), subject());
    vi.advanceTimersByTime(MOCK_SEND_DELAY_MS);
    expect(rows()[0]).toMatchObject({ status: "sent", route: "evolution" });
  });

  it("skips template_missing on coexistence without a template, sends with one", async () => {
    await api.whatsapp.saveCoexistence(admin, coexistence({ accessToken: TOKEN }));
    await api.notifications.updateSettings(admin, {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      whatsappEnabled: true,
    });
    queueNotification(getState(), subject());
    vi.advanceTimersByTime(MOCK_SEND_DELAY_MS);
    expect(rows()[0]).toMatchObject({ status: "skipped", skipReason: "template_missing" });
    const templates = {
      ...coexistence().templates,
      prescription: { name: "rx_ready", language: "ar" },
    };
    await api.whatsapp.saveCoexistence(admin, coexistence({ templates }));
    queueNotification(getState(), { ...subject(), subjectId: "visit-2" });
    vi.advanceTimersByTime(MOCK_SEND_DELAY_MS);
    expect(rows().find((r) => r.subjectId === "visit-2")).toMatchObject({
      status: "sent",
      route: "coexistence",
    });
  });

  it("skips whatsapp_disconnected when the link drops before sending", async () => {
    await connectAndScan();
    await api.notifications.updateSettings(admin, {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      whatsappEnabled: true,
    });
    queueNotification(getState(), subject());
    await api.whatsapp.disconnect(admin);
    vi.advanceTimersByTime(MOCK_SEND_DELAY_MS);
    expect(rows()[0]).toMatchObject({ status: "skipped", skipReason: "whatsapp_disconnected" });
  });
});
