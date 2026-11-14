import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { InvoicePdfAction } from "./invoice-pdf-action";

vi.mock("@/shared/api/api-provider", () => ({ useApi: () => ({ finance: { pdf: vi.fn() } }) }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: { kind: "clinic_admin", clinicId: "synthetic", memberId: null } }),
}));

function show() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider manageDocument={false}>
        <InvoicePdfAction invoiceId="synthetic-invoice" onErrorChange={() => {}} />
      </I18nProvider>
    </QueryClientProvider>,
  );
}
afterEach(cleanup);

describe("the invoice PDF button on phones and screen readers", () => {
  it("the status region is there before the click, so 'Preparing' is announced", () => {
    show();
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("the button is at least 44px tall below the sm breakpoint only", () => {
    show();
    expect(screen.getByRole("button").className).toContain("max-sm:min-h-11");
  });
});
