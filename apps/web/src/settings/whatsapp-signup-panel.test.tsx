import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTIFICATION_KINDS } from "@eyadex/contracts/notifications";
import type { WhatsappChannelView } from "@eyadex/contracts/whatsapp";
import { ApiError, whatsappUnavailableError } from "@/shared/api/api-error";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { WhatsappBusinessCard } from "./whatsapp-business-card";

const base: WhatsappChannelView = {
  transport: null,
  status: "disconnected",
  hasCredentials: false,
  phoneNumberId: null,
  businessAccountId: null,
  phoneLast4: null,
  riskAcceptedAt: null,
  connectedAt: null,
  lastError: null,
  templates: Object.fromEntries(
    NOTIFICATION_KINDS.map((k) => [k, null]),
  ) as WhatsappChannelView["templates"],
};
const whatsapp = {
  signupConfig: vi.fn(),
  embeddedSignup: vi.fn(),
};
vi.mock("@/shared/api/api-provider", () => ({ useApi: () => ({ whatsapp }) }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: { kind: "clinic_admin", clinicId: "c" }, ready: true }),
}));

beforeEach(() => {
  whatsapp.signupConfig.mockResolvedValue({
    appId: "100000000000001",
    configId: "200000000000002",
    graphVersion: "v21.0",
  });
  whatsapp.embeddedSignup.mockReset();
});
afterEach(() => cleanup());

function show(view = base, onEdit = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider>
        <WhatsappBusinessCard view={view} editable blocked={false} onEdit={onEdit} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return onEdit;
}

describe("one-click WhatsApp Business signup", () => {
  it("hides the signup button when the server answers unavailable", async () => {
    whatsapp.signupConfig.mockRejectedValue(whatsappUnavailableError());
    show();
    await screen.findByText(ar.whatsapp.signup.advanced);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: ar.whatsapp.signup.demo })).toBeNull();
    expect(screen.queryByRole("button", { name: ar.whatsapp.signup.connect })).toBeNull();
  });

  it.each([
    [{ code: "meta_code_invalid" }, ar.whatsapp.errors.meta_code_invalid],
    [{ phoneNumberId: "meta_two_step_enabled" }, ar.whatsapp.errors.meta_two_step_enabled],
    [{ phoneNumberId: "number_in_use" }, ar.whatsapp.errors.number_in_use],
  ])("shows the refusal %o inline", async (details, text) => {
    whatsapp.embeddedSignup.mockRejectedValue(new ApiError("validation", undefined, details));
    show();
    fireEvent.click(await screen.findByRole("button", { name: ar.whatsapp.signup.demo }));
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it("503 shows the existing unavailable copy", async () => {
    whatsapp.embeddedSignup.mockRejectedValue(whatsappUnavailableError());
    show();
    fireEvent.click(await screen.findByRole("button", { name: ar.whatsapp.signup.demo }));
    expect(await screen.findByText(ar.whatsapp.unavailableTitle)).toBeInTheDocument();
  });

  it("success opens the templates; a connected card shows «متصل …1234»", async () => {
    whatsapp.embeddedSignup.mockResolvedValue({ ...base, status: "connected" });
    const onEdit = show();
    fireEvent.click(await screen.findByRole("button", { name: ar.whatsapp.signup.demo }));
    await vi.waitFor(() => expect(onEdit).toHaveBeenCalled());
    cleanup();
    show({ ...base, transport: "coexistence", status: "connected", phoneLast4: "1234" });
    expect(screen.getByText("متصل …1234")).toBeInTheDocument();
  });

  it("the demo code cancel does nothing", async () => {
    show();
    fireEvent.change(await screen.findByLabelText(ar.whatsapp.signup.demoCode), {
      target: { value: "cancel" },
    });
    fireEvent.click(screen.getByRole("button", { name: ar.whatsapp.signup.demo }));
    expect(whatsapp.embeddedSignup).not.toHaveBeenCalled();
  });

  it("the manual form sits under «متقدّم»", async () => {
    const onEdit = show();
    expect(screen.queryByRole("button", { name: ar.whatsapp.business.set })).toBeNull();
    fireEvent.click(screen.getByText(ar.whatsapp.signup.advanced));
    fireEvent.click(screen.getByRole("button", { name: ar.whatsapp.business.set }));
    expect(onEdit).toHaveBeenCalled();
  });
});
