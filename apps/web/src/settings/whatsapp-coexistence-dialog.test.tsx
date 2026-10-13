import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WhatsappChannelView } from "@eyadex/contracts/whatsapp";
import { NOTIFICATION_KINDS } from "@eyadex/contracts/notifications";
import { ApiError } from "@/shared/api/api-error";
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
