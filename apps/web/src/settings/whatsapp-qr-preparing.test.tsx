import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { ar } from "@/shared/i18n/ar";
import { WhatsappQrDialog } from "./whatsapp-qr-dialog";

vi.mock("@/shared/api/api-provider", () => ({ useApi: () => ({ whatsapp: { qr: vi.fn() } }) }));
vi.mock("@/shared/persona/persona-provider", () => ({ usePersona: () => ({ persona: {} }) }));
vi.mock("./whatsapp-queries", () => ({ useRefreshWhatsapp: () => vi.fn() }));
afterEach(() => cleanup());

describe("QR dialog while the code is being prepared", () => {
  it("shows the preparing spinner and no image while pending without a QR", () => {
    render(
      <I18nProvider>
        <WhatsappQrDialog
          start={{ status: "pending", qrDataUrl: null }}
          onClose={() => undefined}
        />
      </I18nProvider>,
    );
    expect(screen.getByText(ar.whatsapp.qr.preparing)).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
