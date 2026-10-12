import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NOTIFICATION_SETTINGS } from "@eyadex/contracts/notifications";
import { api, as, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { MAIL_TEST_REPORT_MS } from "@/shared/api/mock/mock-notifications";

const admin = () => as("clinic_admin");
const provider = {
  kind: "resend" as const,
  apiKey: "fixture-only",
  fromName: "Clinic fixture",
  fromEmail: "desk@example.invalid",
};

beforeEach(() => {
  vi.useFakeTimers();
  resetMockData();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("notification provider refusal parity", () => {
  it("the cooldown covers both slots and returns the remaining whole seconds", async () => {
    await api.notifications.setMailProvider(admin(), "primary", provider, "primary");
    await api.notifications.setMailProvider(admin(), "fallback", provider, "fallback");
    await api.notifications.testMailProvider(admin(), "primary", "test-primary");
    vi.advanceTimersByTime(30_100);
    await expect(
      api.notifications.testMailProvider(admin(), "fallback", "test-fallback"),
    ).rejects.toMatchObject({ code: "rate_limited", details: { retryAfterSeconds: 30 } });
    vi.advanceTimersByTime(29_900);
    await expect(
      api.notifications.testMailProvider(admin(), "fallback", "test-fallback"),
    ).resolves.toBeUndefined();
  });

  it("a pending report cannot verify a provider removed and recreated in the same slot", async () => {
    await api.notifications.setMailProvider(admin(), "primary", provider, "original");
    await api.notifications.testMailProvider(admin(), "primary", "test-original");
    await api.notifications.removeMailProvider(admin(), "primary");
    await api.notifications.setMailProvider(admin(), "primary", provider, "recreated");
    vi.advanceTimersByTime(MAIL_TEST_REPORT_MS);
    expect((await api.notifications.mailProviders(admin())).primary?.verifiedAt).toBeNull();
  });

  it("fallback without primary returns the HTTP adapter's field refusal", async () => {
    await expect(
      api.notifications.setMailProvider(admin(), "fallback", provider, "fallback"),
    ).rejects.toMatchObject({ code: "validation", details: { slot: "fallback_without_primary" } });
  });

  it("removing a primary with a fallback returns the HTTP adapter's field refusal", async () => {
    await api.notifications.setMailProvider(admin(), "primary", provider, "primary");
    await api.notifications.setMailProvider(admin(), "fallback", provider, "fallback");
    await expect(api.notifications.removeMailProvider(admin(), "primary")).rejects.toMatchObject({
      code: "validation",
      details: { slot: "primary_has_fallback" },
    });
  });
});

describe("notification settings audit parity", () => {
  it("uses the notification action so its filter finds the change", async () => {
    const settings = { ...DEFAULT_NOTIFICATION_SETTINGS, emailEnabled: false };
    await api.notifications.updateSettings(admin(), settings);
    expect(getState().clinicAudit).toHaveLength(1);
    expect(getState().clinicAudit[0]).toMatchObject({
      action: "clinic.notification_settings_updated",
      entity: "clinic",
    });
  });

  it("saving unchanged stored settings adds no audit row, regardless of object key order", async () => {
    await api.notifications.updateSettings(admin(), DEFAULT_NOTIFICATION_SETTINGS);
    const reordered = {
      messages: { ...DEFAULT_NOTIFICATION_SETTINGS.messages },
      emailEnabled: DEFAULT_NOTIFICATION_SETTINGS.emailEnabled,
    };
    const auditCount = getState().clinicAudit.length;
    await expect(api.notifications.updateSettings(admin(), reordered)).resolves.toEqual(
      DEFAULT_NOTIFICATION_SETTINGS,
    );
    expect(getState().clinicAudit).toHaveLength(auditCount);
  });
});
