import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NOTIFICATION_KINDS } from "@eyadex/contracts/notifications";
import type { WhatsappChannelView } from "@eyadex/contracts/whatsapp";
import { whatsappUnavailableError } from "@/shared/api/api-error";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { WhatsappSettingsContent } from "./whatsapp-settings-content";

const view: WhatsappChannelView = {
  transport: null,
  status: "disconnected",
  hasCredentials: false,
  phoneNumberId: null,
  businessAccountId: null,
  phoneLast4: null,
  riskAcceptedAt: "2026-10-12T08:00:00.000Z",
  connectedAt: null,
  lastError: null,
  templates: Object.fromEntries(
    NOTIFICATION_KINDS.map((k) => [k, null]),
  ) as WhatsappChannelView["templates"],
};
vi.mock("@/shared/api/api-provider", () => ({
  useApi: () => ({
    whatsapp: {
      channel: async () => view,
      connect: async () => Promise.reject(whatsappUnavailableError()),
    },
  }),
}));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: { kind: "clinic_admin" }, ready: true }),
  useSession: () => ({
    session: { permissions: ["view:clinic_settings:clinic", "update:clinic_settings:clinic"] },
  }),
}));
afterEach(() => cleanup());

describe("WhatsApp not available on this server", () => {
  it("blocks only the QR card; WhatsApp Business stays usable", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <I18nProvider>
          <WhatsappSettingsContent />
        </I18nProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: ar.whatsapp.qr.connect }));
    expect(await screen.findByText(ar.whatsapp.unavailableTitle)).toBeTruthy();
    expect(screen.queryByText(ar.whatsapp.qr.title)).toBeNull();
    expect(screen.getByText(ar.whatsapp.business.title)).toBeTruthy();
    expect(screen.getByRole("button", { name: ar.whatsapp.business.set })).toBeEnabled();
  });
});
