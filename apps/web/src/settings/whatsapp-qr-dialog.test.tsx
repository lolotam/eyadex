import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, whatsappUnavailableError } from "@/shared/api/api-error";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { ar } from "@/shared/i18n/ar";
import { WhatsappQrDialog } from "./whatsapp-qr-dialog";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: vi.fn() } }));
vi.mock("@/shared/api/api-provider", () => ({ useApi: () => ({ whatsapp: { qr: vi.fn() } }) }));
vi.mock("@/shared/persona/persona-provider", () => ({ usePersona: () => ({ persona: {} }) }));
vi.mock("./whatsapp-queries", () => ({ useRefreshWhatsapp: () => vi.fn() }));
vi.mock("./use-qr-polling", () => ({
  useQrPolling: () => ({ qr: null, expired: true, refresh: mocks.refresh }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("manual QR refresh", () => {
  it.each([
    [new ApiError("unknown"), ar.errors.unknown],
    [whatsappUnavailableError(), ar.whatsapp.unavailableTitle],
  ])("shows the refusal without an unhandled rejection", async (error, message) => {
    mocks.refresh.mockRejectedValue(error);
    render(
      <I18nProvider>
        <WhatsappQrDialog
          start={{ status: "pending", qrDataUrl: null }}
          onClose={() => undefined}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: ar.whatsapp.qr.refresh }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(message));
  });
});
