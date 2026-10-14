import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, as, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { ar } from "@/shared/i18n/ar";
import { en } from "@/shared/i18n/en";
import { WhatsappSettingsContent } from "./whatsapp-settings-content";

const whatsapp = {
  channel: vi.fn(),
  signupConfig: vi.fn(),
  embeddedSignup: vi.fn(),
  saveCoexistence: vi.fn(),
};
vi.mock("@/shared/api/api-provider", () => ({ useApi: () => ({ whatsapp }) }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: as("clinic_admin"), ready: true }),
  useSession: () => ({
    session: { permissions: ["view:clinic_settings:clinic", "update:clinic_settings:clinic"] },
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.removeItem("eyadex:language");
});

describe.each(["ar", "en"] as const)("signup templates (%s)", (lang) => {
  it("opens with the newly linked ids before the background refetch completes", async () => {
    resetMockData();
    const admin = as("clinic_admin");
    const initial = await api.whatsapp.channel(admin);
    whatsapp.channel.mockResolvedValueOnce(initial).mockImplementation(() => new Promise(() => {}));
    whatsapp.signupConfig.mockImplementation(() => api.whatsapp.signupConfig(admin));
    whatsapp.embeddedSignup.mockImplementation((_persona, input) =>
      api.whatsapp.embeddedSignup(admin, input),
    );
    whatsapp.saveCoexistence.mockImplementation((_persona, input) =>
      api.whatsapp.saveCoexistence(admin, input),
    );
    localStorage.setItem("eyadex:language", lang);
    const dict = lang === "ar" ? ar : en;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <I18nProvider>
          <WhatsappSettingsContent />
        </I18nProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: dict.whatsapp.signup.demo }));
    const phoneInput = await screen.findByLabelText(dict.whatsapp.business.fields.phoneNumberId);
    const linked = await api.whatsapp.channel(admin);
    expect(phoneInput).toHaveValue(linked.phoneNumberId);
    expect(screen.getByLabelText(dict.whatsapp.business.fields.businessAccountId)).toHaveValue(
      linked.businessAccountId,
    );
    expect(screen.getByLabelText(dict.whatsapp.business.fields.accessToken)).toHaveValue("");
    fireEvent.change(
      screen.getByLabelText(
        `${dict.notificationSettings.kinds.booked} — ${dict.whatsapp.business.templateName}`,
      ),
      {
        target: { value: "booking_ready" },
      },
    );
    fireEvent.change(
      screen.getByLabelText(
        `${dict.notificationSettings.kinds.booked} — ${dict.whatsapp.business.templateLanguage}`,
      ),
      {
        target: { value: lang },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: dict.common.save }));
    await waitFor(() => expect(whatsapp.saveCoexistence).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await api.whatsapp.channel(admin)).templates.booked).toEqual({
      name: "booking_ready",
      language: lang,
    });
    client.clear();
  });
});
