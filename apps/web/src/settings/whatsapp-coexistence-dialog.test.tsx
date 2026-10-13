import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WhatsappChannelView } from "@eyadex/contracts/whatsapp";
import { NOTIFICATION_KINDS } from "@eyadex/contracts/notifications";
import { ApiError } from "@/shared/api/api-error";
import { api, as, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { ar } from "@/shared/i18n/ar";
import { en } from "@/shared/i18n/en";
import { WhatsappCoexistenceDialog } from "./whatsapp-coexistence-dialog";

const save = vi.hoisted(() => vi.fn());
vi.mock("@/shared/api/api-provider", () => ({
  useApi: () => ({ whatsapp: { saveCoexistence: save } }),
}));
vi.mock("@/shared/persona/persona-provider", () => ({ usePersona: () => ({ persona: {} }) }));
const view: WhatsappChannelView = {
  transport: "coexistence",
  status: "connected",
  hasCredentials: true,
  phoneNumberId: "100000000001",
  businessAccountId: "200000000002",
  phoneLast4: null,
  riskAcceptedAt: null,
  connectedAt: null,
  lastError: null,
  templates: Object.fromEntries(
    NOTIFICATION_KINDS.map((kind) => [kind, null]),
  ) as WhatsappChannelView["templates"],
};

function mount(channel: WhatsappChannelView, lang: "ar" | "en") {
  localStorage.setItem("eyadex:language", lang);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider>
        <WhatsappCoexistenceDialog view={channel} open onClose={() => undefined} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  const dict = lang === "ar" ? ar : en;
  fireEvent.change(screen.getByLabelText(dict.whatsapp.business.fields.phoneNumberId), {
    target: { value: "100000000001" },
  });
  fireEvent.change(screen.getByLabelText(dict.whatsapp.business.fields.businessAccountId), {
    target: { value: "200000000002" },
  });
  return dict;
}
afterEach(() => {
  cleanup();
  save.mockReset();
  localStorage.removeItem("eyadex:language");
});

describe.each(["ar", "en"] as const)("coexistence refusals (%s)", (lang) => {
  it("reopens with saved Meta ids and saves templates without retyping ids or the token", async () => {
    resetMockData();
    const admin = as("clinic_admin");
    save.mockImplementation((_persona, request) => api.whatsapp.saveCoexistence(admin, request));
    localStorage.setItem("eyadex:language", lang);
    const dict = lang === "ar" ? ar : en;
    const client = new QueryClient();
    const closed = vi.fn();
    const dialog = (channel: WhatsappChannelView, open: boolean) => (
      <QueryClientProvider client={client}>
        <I18nProvider>
          <WhatsappCoexistenceDialog view={channel} open={open} onClose={closed} />
        </I18nProvider>
      </QueryClientProvider>
    );
    const initial = await api.whatsapp.channel(admin);
    const rendered = render(dialog(initial, true));
    fireEvent.change(screen.getByLabelText(dict.whatsapp.business.fields.phoneNumberId), {
      target: { value: view.phoneNumberId },
    });
    fireEvent.change(screen.getByLabelText(dict.whatsapp.business.fields.businessAccountId), {
      target: { value: view.businessAccountId },
    });
    fireEvent.change(screen.getByLabelText(dict.whatsapp.business.fields.accessToken), {
      target: { value: crypto.randomUUID() },
    });
    fireEvent.click(screen.getByRole("button", { name: dict.common.save }));
    await waitFor(() => expect(closed).toHaveBeenCalledTimes(1));
    const saved = await api.whatsapp.channel(admin);
    rendered.rerender(dialog(saved, false));
    rendered.rerender(dialog(saved, true));
    expect(screen.getByLabelText(dict.whatsapp.business.fields.phoneNumberId)).toHaveValue(
      view.phoneNumberId,
    );
    expect(screen.getByLabelText(dict.whatsapp.business.fields.businessAccountId)).toHaveValue(
      view.businessAccountId,
    );
    expect(screen.getByLabelText(dict.whatsapp.business.fields.accessToken)).toHaveValue("");
    fireEvent.change(
      screen.getByLabelText(
        `${dict.notificationSettings.kinds.booked} — ${dict.whatsapp.business.templateName}`,
      ),
      { target: { value: "booking_updated" } },
    );
    fireEvent.change(
      screen.getByLabelText(
        `${dict.notificationSettings.kinds.booked} — ${dict.whatsapp.business.templateLanguage}`,
      ),
      { target: { value: lang } },
    );
    fireEvent.click(screen.getByRole("button", { name: dict.common.save }));
    await waitFor(() => expect(closed).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]![1]).not.toHaveProperty("accessToken");
    expect((await api.whatsapp.channel(admin)).templates.booked).toEqual({
      name: "booking_updated",
      language: lang,
    });
  });

  it("shows the API transport refusal in the form", async () => {
    save.mockRejectedValue(
      new ApiError("validation", undefined, { transport: "evolution_linked" }),
    );
    const dict = mount(view, lang);
    fireEvent.click(screen.getByRole("button", { name: dict.common.save }));
    expect(await screen.findByText(dict.whatsapp.errors.evolution_linked)).toBeTruthy();
  });

  it("shows Meta's credentials refusal under the token field", async () => {
    save.mockRejectedValue(
      new ApiError("validation", undefined, { accessToken: "meta_credentials_invalid" }),
    );
    const dict = mount(view, lang);
    fireEvent.click(screen.getByRole("button", { name: dict.common.save }));
    expect(await screen.findByText(dict.whatsapp.errors.meta_credentials_invalid)).toBeTruthy();
  });

  it("shows the API's required-token refusal under the token field", async () => {
    save.mockRejectedValue(new ApiError("validation", undefined, { accessToken: "required" }));
    const dict = mount(view, lang);
    fireEvent.click(screen.getByRole("button", { name: dict.common.save }));
    expect(await screen.findByText(dict.validation.required)).toBeTruthy();
  });

  it("requires a token when the current transport is Evolution, even with stored credentials", async () => {
    const dict = mount({ ...view, transport: "evolution", status: "disconnected" }, lang);
    expect(screen.queryByText(dict.whatsapp.business.tokenStored)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: dict.common.save }));
    await waitFor(() => expect(screen.getByText(dict.validation.required)).toBeTruthy());
    expect(save).not.toHaveBeenCalled();
  });
});
