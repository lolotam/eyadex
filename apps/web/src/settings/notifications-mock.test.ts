import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NOTIFICATION_SETTINGS } from "@eyadex/contracts/notifications";
import { api, as, clinicIdAt, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { MAIL_TEST_REPORT_MS } from "@/shared/api/mock/mock-notifications";

const admin = () => as("clinic_admin");
const RESEND = {
  kind: "resend" as const,
  apiKey: "re_fictional_key_for_tests",
  fromName: "Demo Clinic",
  fromEmail: "Desk@Example.invalid",
};
const SMTP = {
  kind: "smtp" as const,
  host: "smtp.example.com",
  port: 587,
  user: "desk",
  password: "fictional-password",
  fromName: "Demo Clinic",
  fromEmail: "desk@example.invalid",
};
const key = () => crypto.randomUUID();

function roleOf(kind: string) {
  const db = getState();
  const role = db.roles.find((r) => r.clinicId === clinicIdAt(0) && r.systemKey === kind);
  if (!role) throw new Error(kind);
  return role;
}

beforeEach(() => resetMockData());
afterEach(() => vi.useRealTimers());

describe("notification settings (N-1)", () => {
  it("a clinic that never saved reads the defaults", async () => {
    expect(await api.notifications.getSettings(admin())).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
  });

  it("saves and reads back the switches", async () => {
    const next = {
      emailEnabled: true,
      messages: { ...DEFAULT_NOTIFICATION_SETTINGS.messages, reminder_2h: false },
    };
    await api.notifications.updateSettings(admin(), next);
    expect(await api.notifications.getSettings(admin())).toEqual(next);
  });

  it("NEGATIVE: view without update reads but cannot save", async () => {
    roleOf("doctor").permissions = ["view:clinic_settings:clinic"];
    await expect(api.notifications.getSettings(as("doctor"))).resolves.toBeTruthy();
    await expect(
      api.notifications.updateSettings(as("doctor"), DEFAULT_NOTIFICATION_SETTINGS),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("NEGATIVE: an unknown message kind is refused", async () => {
    const bad = { ...DEFAULT_NOTIFICATION_SETTINGS, messages: { booked: true } };
    await expect(
      api.notifications.updateSettings(admin(), bad as typeof DEFAULT_NOTIFICATION_SETTINGS),
    ).rejects.toMatchObject({ code: "validation" });
  });
});

describe("mail providers (N-3)", () => {
  it("sets a primary: not verified, no credential returned, email lower-cased", async () => {
    const view = await api.notifications.setMailProvider(admin(), "primary", RESEND, key());
    expect(view).toMatchObject({ kind: "resend", fromEmail: "desk@example.invalid" });
    expect(view.verifiedAt).toBeNull();
    expect(JSON.stringify(await api.notifications.mailProviders(admin()))).not.toContain(
      RESEND.apiKey,
    );
  });

  it("replacing the primary resets it to not verified", async () => {
    vi.useFakeTimers();
    await api.notifications.setMailProvider(admin(), "primary", RESEND, key());
    await api.notifications.testMailProvider(admin(), "primary", key());
    vi.advanceTimersByTime(MAIL_TEST_REPORT_MS);
    expect((await api.notifications.mailProviders(admin())).primary?.verifiedAt).not.toBeNull();
    const replaced = await api.notifications.setMailProvider(admin(), "primary", SMTP, key());
    expect(replaced).toMatchObject({
      kind: "smtp",
      smtpHost: "smtp.example.com",
      verifiedAt: null,
    });
  });

  it("NEGATIVE: a fallback with no primary is refused", async () => {
    await expect(
      api.notifications.setMailProvider(admin(), "fallback", SMTP, key()),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("NEGATIVE: removing the primary while a fallback exists is refused", async () => {
    await api.notifications.setMailProvider(admin(), "primary", RESEND, key());
    await api.notifications.setMailProvider(admin(), "fallback", SMTP, key());
    await expect(api.notifications.removeMailProvider(admin(), "primary")).rejects.toMatchObject({
      code: "validation",
    });
    await api.notifications.removeMailProvider(admin(), "fallback");
    await api.notifications.removeMailProvider(admin(), "primary");
    expect(await api.notifications.mailProviders(admin())).toEqual({
      primary: null,
      fallback: null,
    });
  });

  it("test: verified after the report; a second test inside the cooldown is rate_limited", async () => {
    vi.useFakeTimers();
    await api.notifications.setMailProvider(admin(), "primary", RESEND, key());
    await api.notifications.testMailProvider(admin(), "primary", key());
    await expect(
      api.notifications.testMailProvider(admin(), "primary", key()),
    ).rejects.toMatchObject({ code: "rate_limited" });
    vi.advanceTimersByTime(MAIL_TEST_REPORT_MS);
    expect((await api.notifications.mailProviders(admin())).primary?.verifiedAt).not.toBeNull();
  });

  it("NEGATIVE: testing an empty slot is not_found; a bad request is validation", async () => {
    await expect(
      api.notifications.testMailProvider(admin(), "primary", key()),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      api.notifications.setMailProvider(admin(), "primary", { ...SMTP, port: 2526 }, key()),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("NEGATIVE: a user without the update key cannot set a provider", async () => {
    roleOf("doctor").permissions = ["view:clinic_settings:clinic"];
    await expect(
      api.notifications.setMailProvider(as("doctor"), "primary", RESEND, key()),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
