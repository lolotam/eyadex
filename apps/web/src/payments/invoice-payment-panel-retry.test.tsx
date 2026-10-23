import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Invoice } from "@eyadex/contracts/finance";
import { ApiError } from "@/shared/api/api-error";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { InvoicePaymentPanel } from "./invoice-payment-panel";

const h = vi.hoisted(() => ({
  session: { permissions: [] as string[], allBranches: false, branchIds: [] as string[] },
  invoicePayments: vi.fn(),
  recordPayment: vi.fn(),
  applyCredit: vi.fn(),
  settings: { data: undefined } as Record<string, unknown>,
}));
vi.mock("@/shared/persona/persona-provider", () => ({
  useSession: () => ({ session: h.session }),
  usePersona: () => ({
    persona: { kind: "clinic_admin", clinicId: "c", memberId: null },
    ready: true,
  }),
}));
vi.mock("@/shared/api/api-provider", () => ({
  useApi: () => ({
    payments: {
      invoicePayments: h.invoicePayments,
      recordPayment: h.recordPayment,
      applyCredit: h.applyCredit,
    },
  }),
}));
vi.mock("@/shared/money/use-clinic-money", () => ({
  useFinanceSettings: () => h.settings,
}));

const BRANCH = "00000000-0000-7000-8000-000000000002";
const PATIENT = "00000000-0000-7000-8000-0000000000c1";
const invoice = {
  id: "00000000-0000-7000-8000-00000000000a",
  number: "TT-2026-000001",
  status: "issued",
  branchId: BRANCH,
  patientId: PATIENT,
  currency: "KWD",
  currencyExponent: 3,
  totalMinor: "5000",
  version: 1,
  settlement: { state: "partly_paid", paidMinor: "1000", owedMinor: "4000" },
} as unknown as Invoice;
/** Another invoice of the same patient: the credit kept for the first one is not its own. */
const other = {
  ...invoice,
  id: "00000000-0000-7000-8000-00000000000d",
  number: "TT-2026-000002",
} as unknown as Invoice;
/** The same invoice after a payment landed on it: the balance due fell. */
const moved = {
  ...invoice,
  totalMinor: "7000",
  settlement: { state: "partly_paid", paidMinor: "5000", owedMinor: "2000" },
} as unknown as Invoice;
/** The movements of the invoice, as the payments query answers them. */
const movements = [
  {
    kind: "payment",
    paymentId: "00000000-0000-7000-8000-0000000000b1",
    receiptNumber: "TT-R-2026-000001",
    method: "cash",
    amountMinor: "1000",
    at: "2026-10-20T08:00:00.000Z",
  },
];

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const panel = (queries: QueryClient, shown: Invoice = invoice) => (
  <QueryClientProvider client={queries}>
    <I18nProvider>
      <InvoicePaymentPanel invoice={shown} onChanged={() => undefined} />
    </I18nProvider>
  </QueryClientProvider>
);
const amountLabel = () => ar.payments.dialog.amount.replace("{currency}", "KWD");
const available = (amount: string) => ar.payments.dialog.available.replace("{amount}", amount);
const sessionOf = (permissions: string[]) => ({ permissions, allBranches: false, branchIds: [] });
/** Opens the record-payment dialog and sends it, with the amount the user typed. */
const submitOnce = async (amount?: string) => {
  fireEvent.click(screen.getByRole("button", { name: ar.payments.panel.record }));
  const field = await screen.findByLabelText(amountLabel());
  if (amount) fireEvent.change(field, { target: { value: amount } });
  fireEvent.click(await screen.findByRole("button", { name: ar.payments.dialog.submit }));
};

beforeEach(() => {
  h.settings = { data: undefined };
  h.session = sessionOf(["create:payments:clinic"]);
  h.recordPayment.mockReset();
  h.applyCredit.mockReset();
  h.invoicePayments.mockReset();
  h.invoicePayments.mockResolvedValue({ creditBalanceMinor: "2000", movements });
});
afterEach(() => cleanup());

// PR #103 review: an unclear failure keeps the key above the dialog, so a reopened form replays it.
describe("the held Idempotency-Key", () => {
  it("a failed request, reopened with the same values after a version change, sends the same key", async () => {
    h.recordPayment.mockRejectedValueOnce(new ApiError("unknown"));
    h.recordPayment.mockResolvedValueOnce({ payment: { receiptNumber: "TT-R-2026-000002" } });
    const queries = client();
    const view = render(panel(queries));
    await submitOnce();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    view.rerender(panel(queries, { ...invoice, version: 2 }));
    await submitOnce();
    await waitFor(() => expect(h.recordPayment).toHaveBeenCalledTimes(2));
    expect(h.recordPayment.mock.calls[1]![3]).toBe(h.recordPayment.mock.calls[0]![3]);
  });

  // PR #111 review: the warning costs one replacement key, not a new one on every retry.
  it("sends one replacement key for the retries after the warning", async () => {
    h.recordPayment.mockRejectedValue(new ApiError("unknown"));
    const queries = client();
    const view = render(panel(queries));
    await submitOnce();
    await waitFor(() => expect(h.recordPayment).toHaveBeenCalledTimes(1));
    const first = h.recordPayment.mock.calls[0]![3];
    // The invoice's paid amount moved under the held key, so the earlier request may be recorded.
    view.rerender(panel(queries, moved));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await submitOnce();
    expect(await screen.findByText(ar.payments.paidChangedNotice)).toBeInTheDocument();
    await waitFor(() => expect(h.recordPayment).toHaveBeenCalledTimes(2));
    const replacement = h.recordPayment.mock.calls[1]![3];
    expect(replacement).not.toBe(first);
    // The retry after it reuses the replacement, so the API replays it instead of paying twice.
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await submitOnce();
    await waitFor(() => expect(h.recordPayment).toHaveBeenCalledTimes(3));
    expect(h.recordPayment.mock.calls[2]![3]).toBe(replacement);
  });
});

// PR #111 review: the dialog follows the invoice, and a typed amount is never overwritten.
describe("the dialog after the invoice moved", () => {
  it("warns and prefills the new owed amount after an unclear failure", async () => {
    h.recordPayment.mockRejectedValueOnce(new ApiError("unknown"));
    const queries = client();
    const view = render(panel(queries));
    await submitOnce();
    await waitFor(() => expect(h.recordPayment).toHaveBeenCalledTimes(1));
    // The failure keeps the dialog open with its key held under the old paid amount.
    view.rerender(panel(queries, moved));
    expect(await screen.findByText(ar.payments.paidChangedNotice)).toBeInTheDocument();
    expect(screen.getByLabelText(amountLabel())).toHaveValue("2.000");
  });

  it("warns on the credit dialog too", async () => {
    h.session = sessionOf(["view:payments:clinic", "create:payments:clinic"]);
    h.applyCredit.mockRejectedValueOnce(new ApiError("unknown"));
    const queries = client();
    const view = render(panel(queries));
    fireEvent.click(await screen.findByRole("button", { name: ar.payments.panel.useCredit }));
    fireEvent.click(await screen.findByRole("button", { name: ar.payments.dialog.apply }));
    await waitFor(() => expect(h.applyCredit).toHaveBeenCalledTimes(1));
    view.rerender(panel(queries, moved));
    expect(await screen.findByText(ar.payments.paidChangedNotice)).toBeInTheDocument();
  });

  it("moves an untouched amount to the new owed amount", async () => {
    const queries = client();
    const view = render(panel(queries));
    fireEvent.click(screen.getByRole("button", { name: ar.payments.panel.record }));
    expect(await screen.findByLabelText(amountLabel())).toHaveValue("4.000");
    view.rerender(panel(queries, moved));
    await waitFor(() => expect(screen.getByLabelText(amountLabel())).toHaveValue("2.000"));
  });
});

// PR #111 review: the dialog belongs to the invoice it was opened on, and the credit it shows is the
// one the payments query last answered.
describe("the dialog and the invoice on screen", () => {
  it("closes the open dialog when another invoice is shown", async () => {
    const queries = client();
    const view = render(panel(queries));
    fireEvent.click(screen.getByRole("button", { name: ar.payments.panel.record }));
    expect(await screen.findByLabelText(amountLabel())).toBeInTheDocument();
    // The panel stays mounted while the page shows another invoice: the form must not carry what the
    // user typed for the first one over to the second.
    view.rerender(panel(queries, { ...invoice, id: "00000000-0000-7000-8000-00000000000d" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByLabelText(amountLabel())).toBeNull();
  });

  it("keeps the credit the query last showed while it refetches", async () => {
    h.session = sessionOf(["view:payments:clinic", "create:payments:clinic"]);
    const queries = client();
    const view = render(panel(queries));
    fireEvent.click(await screen.findByRole("button", { name: ar.payments.panel.useCredit }));
    expect(await screen.findByText(available("2.000 KWD"))).toBeInTheDocument();
    // The invoice version bumps: the payments query starts over and holds no data of its own.
    h.invoicePayments.mockReturnValue(new Promise(() => undefined));
    view.rerender(panel(queries, { ...invoice, version: 2 }));
    // The open dialog keeps the credit it had, instead of showing "0" until the query answers.
    expect(screen.getByText(available("2.000 KWD"))).toBeInTheDocument();
    expect(screen.getByLabelText(amountLabel())).toHaveValue("2.000");
  });

  // PR #111 review: the credit kept for the loading query belongs to the invoice it was read on.
  it("does not keep the credit of another invoice of the same patient", async () => {
    h.session = sessionOf(["view:payments:clinic", "create:payments:clinic"]);
    const queries = client();
    const view = render(panel(queries));
    const creditButton = await screen.findByRole("button", {
      name: ar.payments.panel.useCredit,
    });
    expect(creditButton).toBeInTheDocument();
    // Another invoice of the same patient is shown, and its query starts over: it holds no data of
    // its own, so the credit read for the first invoice must not be offered on this one.
    h.invoicePayments.mockReturnValue(new Promise(() => undefined));
    view.rerender(panel(queries, other));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: ar.payments.panel.useCredit })).toBeNull(),
    );
  });
});
