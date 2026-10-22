import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Invoice } from "@eyadex/contracts/finance";
import { ApiError } from "@/shared/api/api-error";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { InvoiceVoidDialog } from "./invoice-void-dialog";

const h = vi.hoisted(() => ({
  getInvoice: vi.fn(),
  voidInvoice: vi.fn(),
  voided: vi.fn(),
}));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: { kind: "clinic_admin", clinicId: "c", memberId: null } }),
}));
vi.mock("@/shared/api/api-provider", () => ({
  useApi: () => ({ finance: { getInvoice: h.getInvoice, voidInvoice: h.voidInvoice } }),
}));

const INVOICE_ID = "00000000-0000-7000-8000-000000000001";
const OTHER_ID = "00000000-0000-7000-8000-000000000009";

/** An issued invoice with the given paid amount: the settlement decides whether a void releases money. */
const invoicePaid = (paidMinor: string, id = INVOICE_ID): Invoice => ({
  id,
  number: "TT-2026-000001",
  status: "issued",
  source: "manual",
  sourceId: null,
  branchId: "00000000-0000-7000-8000-000000000002",
  branchNameAr: "فرع",
  branchNameEn: "Branch",
  patientId: "00000000-0000-7000-8000-000000000003",
  issuedAt: "2026-10-15T09:00:00.000Z",
  currency: "KWD",
  currencyExponent: 3,
  subtotalMinor: "4000",
  discountMinor: "0",
  taxRateBp: 0,
  taxMinor: "0",
  totalMinor: "4000",
  settlement: {
    state: paidMinor === "0" ? "unpaid" : "partly_paid",
    paidMinor,
    owedMinor: String(4000 - Number(paidMinor)),
  },
  invoiceDiscount: null,
  lines: [],
  voidReason: null,
  voidedAt: null,
  version: 1,
});

const client = new QueryClient();
const dialog = (invoice: Invoice) => (
  <QueryClientProvider client={client}>
    <I18nProvider manageDocument={false}>
      <InvoiceVoidDialog invoice={invoice} onClose={() => undefined} onVoided={h.voided} />
    </I18nProvider>
  </QueryClientProvider>
);

/** Opens the dialog on an invoice and types the reason a void needs. */
function open(invoice: Invoice) {
  const view = render(dialog(invoice));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "issued twice" } });
  return { view, button: screen.getByRole("button", { name: ar.finance.detail.void }) };
}

/** Presses the void button once it is ready again. */
async function press(button: HTMLElement) {
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

beforeEach(() => {
  h.getInvoice.mockReset();
  h.voidInvoice.mockReset().mockResolvedValue(invoicePaid("0"));
  h.voided.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Issue #107: recording a payment does not bump the invoice's version, so a payment made while the
// void dialog was open would turn into the patient's credit unseen. The dialog reads the invoice again
// before it voids.
describe("the void dialog before it releases money", () => {
  it("warns first and voids on the second click when a payment was recorded", async () => {
    h.getInvoice.mockResolvedValue(invoicePaid("1000"));
    const { button } = open(invoicePaid("0"));
    await press(button);
    expect(await screen.findByText(ar.payments.releaseWarning)).toBeInTheDocument();
    expect(h.voidInvoice).not.toHaveBeenCalled();
    // The invoice is read again before the void, by its own id.
    expect(h.getInvoice.mock.calls[0]![1]).toBe(INVOICE_ID);
    await press(button);
    await waitFor(() => expect(h.voidInvoice).toHaveBeenCalledTimes(1));
    // The void still sends the version the dialog was opened with, so an edit answers version_conflict.
    expect(h.voidInvoice.mock.calls[0]![2]).toBe(1);
    expect(h.voided).toHaveBeenCalledTimes(1);
  });

  it("voids right away, with no warning, when nothing is paid on the invoice", async () => {
    h.getInvoice.mockResolvedValue(invoicePaid("0"));
    const { button } = open(invoicePaid("0"));
    await press(button);
    await waitFor(() => expect(h.voidInvoice).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(ar.payments.releaseWarning)).toBeNull();
  });

  it("warns on open and voids on the first click when the invoice was already paid", async () => {
    h.getInvoice.mockResolvedValue(invoicePaid("1000"));
    const { button } = open(invoicePaid("1000"));
    expect(screen.getByText(ar.payments.releaseWarning)).toBeInTheDocument();
    await press(button);
    await waitFor(() => expect(h.voidInvoice).toHaveBeenCalledTimes(1));
  });

  it("shows the error and voids nothing when the invoice cannot be read again", async () => {
    const errorToast = vi.spyOn(toast, "error");
    h.getInvoice.mockRejectedValue(new ApiError("unknown"));
    const { button } = open(invoicePaid("0"));
    await press(button);
    await waitFor(() => expect(errorToast).toHaveBeenCalledWith(ar.errors.unknown));
    expect(h.voidInvoice).not.toHaveBeenCalled();
  });

  it("shows no warning on another invoice", async () => {
    h.getInvoice.mockResolvedValue(invoicePaid("1000"));
    const { view, button } = open(invoicePaid("0"));
    await press(button);
    expect(await screen.findByText(ar.payments.releaseWarning)).toBeInTheDocument();
    view.rerender(dialog(invoicePaid("0", OTHER_ID)));
    expect(screen.queryByText(ar.payments.releaseWarning)).toBeNull();
  });

  // PR #110 review: the void request goes out after the invoice was read again, so the reason must
  // be the one the confirming click carried, not whatever the field holds when the request is sent.
  it("sends the reason typed before the click, not one typed while reading again", async () => {
    let release: (invoice: Invoice) => void = () => undefined;
    h.getInvoice.mockReturnValue(
      new Promise<Invoice>((resolve) => {
        release = resolve;
      }),
    );
    const { button } = open(invoicePaid("0"));
    await press(button);
    const field = screen.getByRole("textbox");
    fireEvent.change(field, { target: { value: "changed while reading" } });
    expect(field).toHaveValue("changed while reading");
    await act(async () => {
      release(invoicePaid("0"));
    });
    await waitFor(() => expect(h.voidInvoice).toHaveBeenCalledTimes(1));
    expect(h.voidInvoice.mock.calls[0]![3]).toBe("issued twice");
  });
});
