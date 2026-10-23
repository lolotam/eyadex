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
/** The dialog on an invoice, with the close path under the test's control. */
const dialogWith = (invoice: Invoice | null, onClose: () => void) => (
  <QueryClientProvider client={client}>
    <I18nProvider manageDocument={false}>
      <InvoiceVoidDialog invoice={invoice} onClose={onClose} onVoided={h.voided} />
    </I18nProvider>
  </QueryClientProvider>
);
const dialog = (invoice: Invoice) => dialogWith(invoice, () => undefined);

/** Opens the dialog on an invoice with the close path under the test's control. */
function openWith(invoice: Invoice, onClose: () => void) {
  const view = render(dialogWith(invoice, onClose));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "issued twice" } });
  return { view, button: screen.getByRole("button", { name: ar.finance.detail.void }) };
}

/** Opens the dialog on an invoice and types the reason a void needs. */
function open(invoice: Invoice) {
  return openWith(invoice, () => undefined);
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

// Issue #113: the API refuses a void when the invoice was paid more since the amount the user
// confirmed, so the void carries that amount and the refusal leaves the dialog open.
describe("the void dialog and the confirmed paid amount", () => {
  it("sends the paid amount of the invoice it read again", async () => {
    h.getInvoice.mockResolvedValue(invoicePaid("1000"));
    const { button } = open(invoicePaid("0"));
    await press(button);
    // The warning comes first, so the void waits for the next click.
    expect(await screen.findByText(ar.payments.releaseWarning)).toBeInTheDocument();
    await press(button);
    await waitFor(() => expect(h.voidInvoice).toHaveBeenCalledTimes(1));
    // The amount the read showed, not the one the dialog was opened with.
    expect(h.voidInvoice.mock.calls[0]![4]).toBe("1000");
  });

  it("stays open and shows the error when the paid amount changed", async () => {
    const errorToast = vi.spyOn(toast, "error");
    h.getInvoice.mockResolvedValue(invoicePaid("1000"));
    h.voidInvoice.mockRejectedValue(
      new ApiError("unknown", undefined, { code: "invoice_paid_changed" }),
    );
    const { button } = open(invoicePaid("1000"));
    await press(button);
    await waitFor(() => expect(errorToast).toHaveBeenCalledWith(ar.errors.invoice_paid_changed));
    // The dialog stays open: nothing was voided and the warning is still there.
    expect(h.voided).not.toHaveBeenCalled();
    expect(screen.getByText(ar.payments.releaseWarning)).toBeInTheDocument();
    // The invoice is read again, so the warning shows the amount it carries now.
    await waitFor(() => expect(h.getInvoice).toHaveBeenCalledTimes(2));
  });
});

// PR #110 review: the void goes out after the invoice was read again, so the dialog must not close
// while that read is running, and a read that answers after the user closed the dialog must not
// void the invoice.
describe("the void dialog while a void is on its way", () => {
  it("does not close while the invoice is read again", async () => {
    // The read never answers, so the dialog stays busy for the whole test.
    h.getInvoice.mockReturnValue(new Promise<Invoice>(() => undefined));
    const closed = vi.fn();
    const { button } = openWith(invoicePaid("0"), closed);
    await press(button);
    // The void is on its way: the button that confirms it is locked.
    await waitFor(() => expect(button).toBeDisabled());
    // The close button does nothing while the void runs.
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(closed).not.toHaveBeenCalled();
    // And neither does Escape.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(closed).not.toHaveBeenCalled();
    expect(h.voidInvoice).not.toHaveBeenCalled();
  });

  it("closes again once the void is done", async () => {
    h.getInvoice.mockResolvedValue(invoicePaid("0"));
    const closed = vi.fn();
    const { button } = openWith(invoicePaid("0"), closed);
    await press(button);
    await waitFor(() => expect(h.voidInvoice).toHaveBeenCalledTimes(1));
    // The void is done, so the dialog is free to close again.
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("voids nothing when the dialog was closed while the invoice was read again", async () => {
    let release: (invoice: Invoice) => void = () => undefined;
    h.getInvoice.mockReturnValue(
      new Promise<Invoice>((resolve) => {
        release = resolve;
      }),
    );
    const closed = vi.fn();
    const { view, button } = openWith(invoicePaid("0"), closed);
    await press(button);
    // The user closed the dialog anyway: the parent cleared the invoice.
    view.rerender(dialogWith(null, closed));
    await act(async () => {
      release(invoicePaid("0"));
    });
    // The read answered and the dialog is gone, so nothing was voided: the same read with the
    // dialog still open does void the invoice (the test above this block).
    expect(h.voidInvoice).not.toHaveBeenCalled();
    expect(h.voided).not.toHaveBeenCalled();
  });
});
