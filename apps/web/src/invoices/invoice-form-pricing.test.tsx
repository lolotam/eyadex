import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Invoice } from "@eyadex/contracts/finance";
import { formatMinor } from "@eyadex/contracts/money";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { InvoiceForm } from "./invoice-form";
import type { InvoiceFormValues } from "./invoice-form-draft";

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const D1 = "33333333-3333-4333-8333-333333333333";
const D2 = "44444444-4444-4444-8444-444444444444";

const state = vi.hoisted(() => ({ permissions: [] as string[], prices: vi.fn() }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: { clinicId: "clinic", memberId: "member" }, ready: true }),
  useSession: () => ({
    session: { permissions: state.permissions, allBranches: true, branchIds: [] },
    isLoading: false,
  }),
}));
vi.mock("@/shared/api/api-provider", () => ({
  useApi: () => ({ finance: { prices: state.prices, issue: vi.fn(), edit: vi.fn() } }),
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
  useInvoiceOptions: () => ({
    services: [
      { id: S1, nameAr: "كشف", nameEn: "Exam" },
      { id: S2, nameAr: "جلسة", nameEn: "Session" },
    ],
    providers: [
      { membershipId: D1, fullName: "D1" },
      { membershipId: D2, fullName: "D2" },
    ],
    branches: [],
    createBranches: [],
  }),
}));
// A native select stands in for the popup one, so a pick is one change event.
vi.mock("@/components/ui/select", () => ({
  Select: (p: { value: string; onValueChange: (v: string) => void; children: ReactNode }) => (
    <select value={p.value} onChange={(e) => p.onValueChange(e.target.value)}>
      {p.children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: (p: { children: ReactNode }) => <>{p.children}</>,
  SelectItem: (p: { value: string; children: ReactNode }) => (
    <option value={p.value}>{p.children}</option>
  ),
}));

const LIST = {
  currency: "KWD",
  currencyExponent: 3,
  items: [
    { serviceId: S1, priceMinor: "2000", providerPrices: [{ memberId: D1, priceMinor: "3500" }] },
    { serviceId: S2, priceMinor: null, providerPrices: [] },
  ],
};
const MISSING = "لا يوجد سعر لهذه الخدمة";

function line(unitPrice: string): InvoiceFormValues["lines"][number] {
  return { kind: "service", serviceId: S1, providerId: null, quantity: 1, unitPrice, discount: null };
}

function show(initial: InvoiceFormValues, editing: Invoice | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider manageDocument={false}>
        <InvoiceForm
          initial={initial}
          source={{ source: "visit", sourceId: "visit" }}
          editing={editing}
          mayDiscountAt={() => false}
          priceMissing={false}
          onDone={vi.fn()}
        />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return client;
}

const values = (lines: InvoiceFormValues["lines"]): InvoiceFormValues => ({
  patientId: "p",
  branchId: "b",
  lines,
  invoiceDiscount: null,
});
const price = () => screen.getByLabelText("سعر الوحدة") as HTMLInputElement;
const [service, doctor] = [0, 1].map((i) => () => screen.getAllByRole("combobox")[i]!);
const loaded = () => waitFor(() => expect(state.prices).toHaveBeenCalled());

beforeEach(() => {
  state.permissions = ["create:invoices:branch", "view:prices:clinic"];
  state.prices.mockReset().mockResolvedValue(LIST);
});
afterEach(cleanup);

describe("invoice line price fills from the price list (owner decision 2026-10-24)", () => {
  it("picking a service fills its base price, and «إضافة خدمة» fills the first line", async () => {
    show(values([]));
    await loaded();
    fireEvent.click(await screen.findByRole("button", { name: /إضافة خدمة/ }));
    await waitFor(() => expect(price().value).toBe("2.000"));
    fireEvent.change(service(), { target: { value: S2 } });
    fireEvent.change(service(), { target: { value: S1 } });
    expect(price().value).toBe("2.000");
  });

  it("a doctor's own price wins, and changing the doctor refills", async () => {
    show(values([line("0.000")]));
    await loaded();
    fireEvent.change(doctor(), { target: { value: D1 } });
    await waitFor(() => expect(price().value).toBe("3.500"));
    fireEvent.change(doctor(), { target: { value: D2 } });
    expect(price().value).toBe("2.000");
  });

  it("a typed price survives a re-render and a background refetch", async () => {
    const client = show(values([line("0.000")]));
    await loaded();
    fireEvent.change(service(), { target: { value: S1 } });
    fireEvent.change(price(), { target: { value: "9.250" } });
    await act(async () => {
      await client.refetchQueries({ queryKey: ["clinic", "prices"] });
    });
    expect(state.prices).toHaveBeenCalledTimes(2);
    expect(price().value).toBe("9.250");
  });

  it("an unpriced service resets the price to 0.000 and shows the message at once", async () => {
    show(values([line("4.000")]));
    await loaded();
    fireEvent.change(service(), { target: { value: S2 } });
    expect(price().value).toBe("0.000");
    expect(await screen.findByText(new RegExp(MISSING))).toBeTruthy();
  });

  it("without view:prices no prices request is made and the line stays manual", async () => {
    state.permissions = ["create:invoices:branch"];
    show(values([line("0.000")]));
    fireEvent.change(service(), { target: { value: S2 } });
    fireEvent.change(doctor(), { target: { value: D1 } });
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(state.prices).not.toHaveBeenCalled();
    expect(price().value).toBe("0.000");
    expect(screen.queryByText(new RegExp(MISSING))).toBeNull();
  });

  it("the edit form keeps the saved prices after the price list loads", async () => {
    const editing = { id: "i", version: 1, taxRateBp: 0, paidMinor: "0" } as unknown as Invoice;
    show(values([line("7.000")]), editing);
    await loaded();
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(price().value).toBe("7.000");
  });
});
