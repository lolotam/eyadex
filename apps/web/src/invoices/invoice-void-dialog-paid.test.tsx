import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Invoice } from "@eyadex/contracts/finance";
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

/** Opens the dialog on an invoice and types the reason a void needs. */
function open(invoice: Invoice) {
  const view = render(dialogWith(invoice, () => undefined));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "issued twice" } });
  return { view, button: screen.getByRole("button", { name: ar.finance.detail.void }) };
}

/** Presses the void button once it is ready again. */
async function press(button: HTMLElement) {
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

/** The paid line as the dialog writes it: the copy with the amount it carries. */
const paidLine = (amount: string) => ar.finance.detail.voidPaidNow.replace("{amount}", amount);

beforeEach(() => {
  h.getInvoice.mockReset();
  h.voidInvoice.mockReset().mockResolvedValue(invoicePaid("0"));
  h.voided.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// PR #110 review: the void carries the paid amount the user confirmed, so the dialog shows that
// amount, and a payment made after the dialog opened is never confirmed unseen.
describe("the void dialog and the paid amount it shows", () => {
  it("shows the paid amount it will confirm", () => {
    open(invoicePaid("1000"));
    expect(screen.getByText(paidLine("1.000 KWD"))).toBeInTheDocument();
  });

  it("shows the new amount and warns when the invoice was paid again", async () => {
    h.getInvoice.mockResolvedValue(invoicePaid("2000"));
    const { button } = open(invoicePaid("1000"));
    await press(button);
    // The amount the read brought back is on screen, and the notice says why this click voided
    // nothing: the user confirms it with another click.
    expect(await screen.findByText(paidLine("2.000 KWD"))).toBeInTheDocument();
    expect(screen.getByText(ar.finance.detail.voidPaidChanged)).toHaveAttribute("role", "alert");
    expect(h.voidInvoice).not.toHaveBeenCalled();
    // The next click confirms the amount on screen.
    await press(button);
    await waitFor(() => expect(h.voidInvoice).toHaveBeenCalledTimes(1));
    expect(h.voidInvoice.mock.calls[0]![4]).toBe("2000");
  });

  it("drops the notice when another invoice is opened", async () => {
    h.getInvoice.mockResolvedValue(invoicePaid("2000"));
    const { view, button } = open(invoicePaid("1000"));
    await press(button);
    expect(await screen.findByText(ar.finance.detail.voidPaidChanged)).toBeInTheDocument();
    view.rerender(dialogWith(invoicePaid("0", OTHER_ID), () => undefined));
    expect(screen.queryByText(ar.finance.detail.voidPaidChanged)).toBeNull();
  });
});
