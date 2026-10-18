import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/api-error";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { NewInvoicePage } from "./new-invoice-page";

const state = vi.hoisted(() => ({
  permissions: [] as string[],
  list: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => state.navigate }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: { clinicId: "clinic", memberId: "member" }, ready: true }),
  useSession: () => ({ session: { permissions: state.permissions }, isLoading: false }),
}));
vi.mock("@/shared/api/api-provider", () => ({
  useApi: () => ({
    finance: {
      listInvoices: state.list,
      draft: async () => ({ lines: [], patientId: "patient", branchId: "branch" }),
    },
  }),
}));
vi.mock("@/shared/money/use-clinic-money", () => ({
  useClinicMoney: () => ({ exponent: 3, settings: { error: null, refetch: vi.fn() } }),
}));
// Keep a real editable DOM value: replacing this form loses the user's draft.
vi.mock("./invoice-form", () => ({
  InvoiceForm: () => <input aria-label="line description" defaultValue="" />,
}));

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider manageDocument={false}>
        <NewInvoicePage source={{ source: "appointment", sourceId: "appointment" }} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  state.permissions = ["create:invoices:branch", "view:invoices:branch"];
  state.navigate.mockReset();
  state.list.mockReset().mockResolvedValue({ items: [], total: 0, nextCursor: null });
});
afterEach(cleanup);

describe("opening a source invoice form", () => {
  it("lets a create-only role open an unbilled appointment without a forbidden lookup", async () => {
    state.permissions = ["create:invoices:branch"];
    state.list.mockRejectedValue(new ApiError("forbidden"));
    show();
    expect(await screen.findByRole("textbox")).toBeTruthy();
    expect(state.list).not.toHaveBeenCalled();
  });

  it("still redirects a viewer to the existing invoice", async () => {
    state.list.mockResolvedValue({ items: [{ id: "invoice" }] });
    show();
    await waitFor(() =>
      expect(state.navigate).toHaveBeenCalledWith({
        to: "/clinic/invoices/$invoiceId",
        params: { invoiceId: "invoice" },
        replace: true,
      }),
    );
  });

  it("redirects an appointment to the invoice issued for its visit", async () => {
    const invoices = [{ id: "visit-invoice", source: "visit", sourceId: "visit" }];
    state.list.mockImplementation(async (_persona, query) => ({
      items: invoices.filter(
        (invoice) =>
          (invoice.source === query.source && invoice.sourceId === query.sourceId) ||
          (query.encounter === true && query.sourceId === "appointment"),
      ),
    }));
    show();
    await waitFor(() =>
      expect(state.navigate).toHaveBeenCalledWith({
        to: "/clinic/invoices/$invoiceId",
        params: { invoiceId: "visit-invoice" },
        replace: true,
      }),
    );
  });

  it("keeps the mounted form and its typed value after a failed background lookup", async () => {
    const client = show();
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "unsaved line" } });
    state.list.mockRejectedValue(new ApiError("forbidden"));
    await act(async () => {
      await client.refetchQueries({ queryKey: ["clinic", "invoices", "source"] });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(state.list).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("textbox")).toBe(input);
    expect((input as HTMLInputElement).value).toBe("unsaved line");
  });

  it("keeps a retry action for an initial lookup failure", async () => {
    state.list.mockRejectedValueOnce(new ApiError("forbidden"));
    show();
    fireEvent.click(await screen.findByRole("button", { name: "حاول مرة أخرى" }));
    expect(await screen.findByRole("textbox")).toBeTruthy();
  });
});
