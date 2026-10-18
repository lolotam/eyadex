import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatMinor } from "@eyadex/contracts/money";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { NewInvoicePage } from "./new-invoice-page";

const state = vi.hoisted(() => ({
  permissions: [] as string[],
  issue: vi.fn(),
  navigate: vi.fn(),
  success: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => state.navigate }));
vi.mock("sonner", () => ({ toast: { success: state.success } }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: { clinicId: "clinic", memberId: "member" }, ready: true }),
  useSession: () => ({
    session: { permissions: state.permissions, allBranches: false, branchIds: ["branch"] },
    isLoading: false,
  }),
}));
vi.mock("@/shared/api/api-provider", () => ({
  useApi: () => ({
    finance: {
      listInvoices: async () => ({ items: [], total: 0, nextCursor: null }),
      draft: async () => ({
        patientId: "patient",
        branchId: "branch",
        priceMissing: false,
        lines: [
          {
            kind: "free",
            descriptionAr: "خدمة",
            descriptionEn: "Service",
            quantity: 1,
            unitPriceMinor: "1000",
            discount: null,
          },
        ],
      }),
      issue: state.issue,
    },
  }),
}));
vi.mock("@/shared/money/use-clinic-money", () => ({
  useClinicMoney: () => ({
    exponent: 3,
    taxRateBp: 0,
    format: (minor: string) => `${formatMinor(minor, 3)} KWD`,
    toMajor: (minor: string) => formatMinor(minor, 3),
    settings: { error: null, refetch: vi.fn() },
  }),
}));
vi.mock("./invoice-options", () => ({
  useInvoiceOptions: () => ({ services: [], providers: [], branches: [], createBranches: [] }),
}));

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <I18nProvider manageDocument={false}>
        <NewInvoicePage source={{ source: "appointment", sourceId: "appointment" }} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return invalidate;
}

async function issue() {
  fireEvent.click(await screen.findByRole("button", { name: "إصدار الفاتورة" }));
  await waitFor(() => expect(state.issue).toHaveBeenCalledTimes(1));
  expect(state.issue).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ source: "appointment", sourceId: "appointment" }),
    expect.any(String),
  );
}

beforeEach(() => {
  state.permissions = ["create:invoices:branch"];
  state.issue.mockReset().mockResolvedValue({ id: "invoice", number: "INV-2026-000001" });
  state.navigate.mockReset();
  state.success.mockReset();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("navigation after issuing an invoice", () => {
  it.each([
    ["ar", "تم إصدار الفاتورة INV-2026-000001"],
    ["en", "Invoice INV-2026-000001 issued"],
  ])(
    "returns a create-only caller to their previous page with a %s success toast",
    async (lang, message) => {
      window.localStorage.setItem("eyadex:language", lang);
      vi.spyOn(window.history, "length", "get").mockReturnValue(2);
      const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
      const invalidate = show();
      fireEvent.click(
        await screen.findByRole("button", {
          name: lang === "ar" ? "إصدار الفاتورة" : "Issue invoice",
        }),
      );
      await waitFor(() => expect(back).toHaveBeenCalledTimes(1));
      expect(state.issue).toHaveBeenCalledTimes(1);
      expect(state.navigate).not.toHaveBeenCalled();
      expect(state.success).toHaveBeenCalledWith(message);
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["clinic", "invoices"] });
    },
  );

  it("returns a create-only caller to /clinic when there is no previous page", async () => {
    vi.spyOn(window.history, "length", "get").mockReturnValue(1);
    const back = vi.spyOn(window.history, "back");
    const invalidate = show();
    await issue();
    await waitFor(() => expect(state.navigate).toHaveBeenCalledExactlyOnceWith({ to: "/clinic" }));
    expect(back).not.toHaveBeenCalled();
    expect(state.success).toHaveBeenCalledWith("تم إصدار الفاتورة INV-2026-000001");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["clinic", "invoices"] });
  });

  it.each(["branch", "clinic", "own"])(
    "keeps the detail navigation for a caller with %s view scope",
    async (scope) => {
      state.permissions.push(`view:invoices:${scope}`);
      const back = vi.spyOn(window.history, "back");
      const invalidate = show();
      await issue();
      await waitFor(() =>
        expect(state.navigate).toHaveBeenCalledExactlyOnceWith({
          to: "/clinic/invoices/$invoiceId",
          params: { invoiceId: "invoice" },
        }),
      );
      expect(back).not.toHaveBeenCalled();
      expect(state.success).not.toHaveBeenCalled();
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["clinic", "invoices"] });
    },
  );
});
