import { getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NOTIFICATION_SETTINGS } from "@eyadex/contracts/notifications";
import { ApiProvider } from "@/shared/api/api-provider";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { NotificationSettingsForm } from "./notification-settings-form";

const session = vi.hoisted(() => ({ permissions: [] as string[] }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({
    persona: { kind: "clinic_admin", clinicId: getState().clinics[0]!.id, memberId: null },
    ready: true,
  }),
  useSession: () => ({ session: { permissions: session.permissions } }),
}));

function renderForm(emailEnabled = true) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider>
        <ApiProvider>
          <NotificationSettingsForm
            settings={{ ...DEFAULT_NOTIFICATION_SETTINGS, emailEnabled }}
            whatsappConnected={false}
          />
        </ApiProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => resetMockData());
afterEach(() => cleanup());

describe("notifications tab", () => {
  it("saves a switched-off message kind", async () => {
    session.permissions = ["view:clinic_settings:clinic", "update:clinic_settings:clinic"];
    renderForm();
    await act(async () =>
      screen.getByRole("switch", { name: ar.notificationSettings.kinds.reminder_day }).click(),
    );
    await act(async () => screen.getByRole("button", { name: ar.common.save }).click());
    const clinicId = getState().clinics[0]!.id;
    await waitFor(() =>
      expect(getState().notifications?.settings[clinicId]?.messages.reminder_day).toBe(false),
    );
  });

  it("read-only without the update key: switches disabled, no save button", () => {
    session.permissions = ["view:clinic_settings:clinic"];
    renderForm();
    expect(
      screen.getByRole("switch", { name: ar.notificationSettings.emailEnabled }),
    ).toBeDisabled();
    expect(screen.queryByRole("button", { name: ar.common.save })).toBeNull();
  });

  it("with email off the six kinds are disabled", () => {
    session.permissions = ["view:clinic_settings:clinic", "update:clinic_settings:clinic"];
    renderForm(false);
    expect(
      screen.getByRole("switch", { name: ar.notificationSettings.kinds.booked }),
    ).toBeDisabled();
    expect(
      screen.getByRole("switch", { name: ar.notificationSettings.emailEnabled }),
    ).toBeEnabled();
  });
});

describe("WhatsApp switch", () => {
  it("is locked with the link hint while WhatsApp is not connected", () => {
    session.permissions = ["view:clinic_settings:clinic", "update:clinic_settings:clinic"];
    renderForm();
    expect(
      screen.getByRole("switch", { name: ar.notificationSettings.whatsappEnabled }),
    ).toBeDisabled();
    expect(screen.getByText(ar.notificationSettings.whatsappNeedsLink)).toBeTruthy();
  });
});
