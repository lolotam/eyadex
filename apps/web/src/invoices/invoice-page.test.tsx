import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Invoice } from "@eyadex/contracts/finance";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { InvoicePage } from "./invoice-page";

const OWN = "00000000-0000-7000-8000-0000000000b1";
const OTHER = "00000000-0000-7000-8000-0000000000b2";

const state = vi.hoisted(() => ({
  invoice: null as unknown,
  voided: [] as number[],
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="#invoices">{children}</a>,
}));
vi.mock("@/shared/api/api-provider", () => ({
  useApi: () => ({
    finance: {
      pdf: async () => new Blob(["%PDF"], { type: "application/pdf" }),
      voidInvoice: async (_p: unknown, _id: string, version: number) => {
        state.voided.push(version);
        return state.invoice;
      },
    },
  }),
}));
// The form shows which version it would save against, the one thing this page decides for it.
vi.mock("./invoice-form", () => ({
  InvoiceForm: ({ editing }: { editing: Invoice }) => <p>{`editing version ${editing.version}`}</p>,
}));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({
    persona: { kind: "clinic_admin", clinicId: "c", memberId: null },
    ready: true,
  }),
  // A clinic-wide view with branch-scoped writes, in branch OWN only.
  useSession: () => ({
    isLoading: false,
    session: {
      permissions: ["view:invoices:clinic", "update:invoices:branch", "deactivate:invoices:branch"],
      allBranches: false,
      branchIds: [OWN],
    },
  }),
}));
vi.mock("./invoice-queries", () => ({
  useInvoice: () => ({ isLoading: false, error: null, data: state.invoice }),
  useRefreshInvoices: () => () => undefined,
}));
vi.mock("./invoice-patient-name", () => ({ InvoicePatientName: () => null }));

const invoiceAt = (branchId: string): Invoice => ({
  id: "00000000-0000-7000-8000-000000000001",
  number: "SLMR-2026-000001",
  status: "issued",
  source: "manual",
  sourceId: null,
  branchId,
  branchNameAr: "فرع",
  branchNameEn: "Branch",
  patientId: "00000000-0000-7000-8000-000000000003",
  issuedAt: "2026-10-15T09:00:00.000Z",
  currency: "KWD",
  currencyExponent: 3,
  subtotalMinor: "1000",
  discountMinor: "0",
  taxRateBp: 0,
  taxMinor: "0",
  totalMinor: "1000",
  invoiceDiscount: null,
  lines: [],
  voidReason: null,
  voidedAt: null,
  version: 1,
});

const page = () => (
  <QueryClientProvider client={new QueryClient()}>
    <I18nProvider manageDocument={false}>
      <InvoicePage invoiceId="00000000-0000-7000-8000-000000000001" />
    </I18nProvider>
  </QueryClientProvider>
);

function show(branchId: string) {
  state.invoice = invoiceAt(branchId);
  return render(page());
}

afterEach(cleanup);

// PR #78 review: viewing reaches further than a branch-scoped write key, so edit and void are offered
// only at the member's own branches, as the API decides; sending needs the view only.
describe("the invoice page's actions", () => {
  it("offers edit and void on an invoice of the member's own branch", () => {
    show(OWN);
    expect(screen.getByRole("button", { name: "تعديل" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "إلغاء الفاتورة" })).toBeTruthy();
  });

  it("hides edit and void on another branch's invoice, and still offers the send", () => {
    show(OTHER);
    expect(screen.queryByRole("button", { name: "تعديل" })).toBeNull();
    expect(screen.queryByRole("button", { name: "إلغاء الفاتورة" })).toBeNull();
    expect(screen.getByRole("button", { name: "إرسال" })).toBeTruthy();
  });
});

// PR #78 review: a background refetch while the edit dialog is open must not hand the form a newer
// version than the lines it shows; the form keeps the invoice as it was when «تعديل» was pressed.
describe("the edit dialog", () => {
  it("keeps the version it opened with when the invoice is refetched", async () => {
    const view = show(OWN);
    fireEvent.click(screen.getByRole("button", { name: "تعديل" }));
    expect(await screen.findByText("editing version 1")).toBeTruthy();
    state.invoice = { ...invoiceAt(OWN), version: 2 };
    view.rerender(page());
    expect(screen.getByText("editing version 1")).toBeTruthy();
  });
});

// PR #78 review: the void dialog confirmed with whatever version a background refetch brought in.
describe("the void dialog", () => {
  it("confirms with the version it opened with", async () => {
    state.voided = [];
    const view = show(OWN);
    fireEvent.click(screen.getByRole("button", { name: "إلغاء الفاتورة" }));
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "issued twice" } });
    state.invoice = { ...invoiceAt(OWN), version: 2 };
    view.rerender(page());
    const confirm = screen.getAllByRole("button", { name: "إلغاء الفاتورة" }).at(-1)!;
    fireEvent.click(confirm);
    await waitFor(() => expect(state.voided).toEqual([1]));
  });
});

// PR #78 review: every PDF press made an object URL that lived as long as the tab.
describe("the PDF button", () => {
  it("opens the tab inside the click, points it at the file, then revokes the URL", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const made = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:invoice");
    const revoked = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const tab = { closed: false, opener: null, location: { href: "" } };
    const opened = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    show(OWN);
    fireEvent.click(screen.getByRole("button", { name: "PDF / طباعة" }));
    // Synchronous: the tab exists before the download resolves.
    expect(opened).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(tab.location.href).toBe("blob:invoice"));
    expect(revoked).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(revoked).toHaveBeenCalledWith("blob:invoice");
    made.mockRestore();
    revoked.mockRestore();
    opened.mockRestore();
    vi.useRealTimers();
  });
});
