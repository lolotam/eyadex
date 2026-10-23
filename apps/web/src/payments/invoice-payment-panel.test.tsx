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
const invoice = {
  id: "00000000-0000-7000-8000-00000000000a",
  number: "TT-2026-000001",
  status: "issued",
  branchId: BRANCH,
  currency: "KWD",
  currencyExponent: 3,
  totalMinor: "5000",
  version: 1,
  settlement: { state: "partly_paid", paidMinor: "1000", owedMinor: "4000" },
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
const show = () => render(panel(client()));
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

describe("the invoice payment panel", () => {
  it("NEGATIVE: an own-scope doctor gets no panel and no movements request", () => {
    h.session = { permissions: ["view:invoices:own"], allBranches: false, branchIds: [] };
    const { container } = show();
    expect(container).toBeEmptyDOMElement();
    expect(h.invoicePayments).not.toHaveBeenCalled();
  });

  it("NEGATIVE: view:payments:branch of another branch sends no request", () => {
    h.session = { permissions: ["view:payments:branch"], allBranches: false, branchIds: ["x"] };
    show();
    expect(h.invoicePayments).not.toHaveBeenCalled();
  });

  it("shows movements, the patient's credit and both actions at the invoice's branch", async () => {
    h.session = {
      permissions: ["view:payments:branch", "create:payments:branch"],
      allBranches: false,
      branchIds: [BRANCH],
    };
    show();
    expect(
      await screen.findByText(ar.payments.movement.payment.replace("{number}", "TT-R-2026-000001")),
    ).toBeInTheDocument();
    expect(screen.getByText("2.000 KWD")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ar.payments.panel.record })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: ar.payments.panel.useCredit })).toBeInTheDocument(),
    );
  });

  it("create:payments without view:payments offers only «تسجيل دفعة»", () => {
    h.session = { permissions: ["create:payments:clinic"], allBranches: false, branchIds: [] };
    show();
    expect(screen.getByRole("button", { name: ar.payments.panel.record })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ar.payments.panel.useCredit })).toBeNull();
    expect(h.invoicePayments).not.toHaveBeenCalled();
  });
});

// PR #103 review: payment entry waits for the clinic's method switches.
describe("payment entry and the finance settings", () => {
  const record = () => screen.getByRole("button", { name: ar.payments.panel.record });

  it("is off while the settings load", () => {
    h.settings = { data: undefined, isLoading: true };
    show();
    expect(record()).toBeDisabled();
  });

  it("is off after a load error, which shows with a retry", () => {
    const refetch = vi.fn();
    h.settings = { data: undefined, isError: true, error: new ApiError("unknown"), refetch };
    show();
    expect(record()).toBeDisabled();
    expect(screen.getByText(ar.payments.panel.settingsError)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ar.common.tryAgain }));
    expect(refetch).toHaveBeenCalled();
  });

  it("a forbidden read keeps every method on, since the API still refuses a disabled one", () => {
    h.settings = { data: undefined, isError: true, error: new ApiError("forbidden") };
    show();
    expect(record()).toBeEnabled();
    expect(screen.queryByText(ar.payments.panel.settingsError)).toBeNull();
  });
});

// PR #103 review: closing while a payment is in flight would drop its Idempotency-Key.
describe("the payment dialog while a request is in flight", () => {
  it("cannot be dismissed until the answer arrives, then closes", async () => {
    let answer: (v: unknown) => void = () => undefined;
    h.recordPayment.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    show();
    fireEvent.click(screen.getByRole("button", { name: ar.payments.panel.record }));
    fireEvent.click(await screen.findByRole("button", { name: ar.payments.dialog.submit }));
    await waitFor(() => expect(h.recordPayment).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    answer({ payment: { receiptNumber: "TT-R-2026-000002" } });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

// PR #103 review: an unclear failure keeps the key above the dialog, so a reopened form replays it.
describe("the held Idempotency-Key", () => {
  it("a failed request, then a higher paid amount, sends a different key", async () => {
    h.recordPayment.mockRejectedValueOnce(new ApiError("unknown"));
    h.recordPayment.mockResolvedValueOnce({ payment: { receiptNumber: "TT-R-2026-000002" } });
    const queries = client();
    const view = render(panel(queries));
    // The same amount both times, so only the invoice's paid amount tells the two requests apart.
    await submitOnce("1.000");
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    view.rerender(panel(queries, moved));
    await submitOnce("1.000");
    await waitFor(() => expect(h.recordPayment).toHaveBeenCalledTimes(2));
    expect(h.recordPayment.mock.calls[1]![3]).not.toBe(h.recordPayment.mock.calls[0]![3]);
  });

  it("a failed request, then another invoice, sends a different key", async () => {
    h.recordPayment.mockRejectedValueOnce(new ApiError("unknown"));
    h.recordPayment.mockResolvedValueOnce({ payment: { receiptNumber: "TT-R-2026-000002" } });
    const queries = client();
    const view = render(panel(queries));
    await submitOnce();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    view.rerender(panel(queries, { ...invoice, id: "00000000-0000-7000-8000-00000000000d" }));
    await submitOnce();
    await waitFor(() => expect(h.recordPayment).toHaveBeenCalledTimes(2));
    expect(h.recordPayment.mock.calls[1]![3]).not.toBe(h.recordPayment.mock.calls[0]![3]);
  });
});

// PR #103 review: an edit or void that releases credit bumps the version, so the movements refetch.
describe("the movements after the invoice changes", () => {
  it("refetches when the invoice version changes", async () => {
    h.session = sessionOf(["view:payments:clinic"]);
    const queries = client();
    const view = render(panel(queries));
    await waitFor(() => expect(h.invoicePayments).toHaveBeenCalledTimes(1));
    view.rerender(panel(queries, { ...invoice, version: 2 }));
    await waitFor(() => expect(h.invoicePayments).toHaveBeenCalledTimes(2));
  });
});

// PR #111 review: the dialog follows the invoice, and a typed amount is never overwritten.
describe("the dialog after the invoice moved", () => {
  it("keeps a typed amount when the owed amount changes", async () => {
    const queries = client();
    const view = render(panel(queries));
    fireEvent.click(screen.getByRole("button", { name: ar.payments.panel.record }));
    fireEvent.change(await screen.findByLabelText(amountLabel()), { target: { value: "1.000" } });
    view.rerender(panel(queries, moved));
    await waitFor(() => expect(screen.getByLabelText(amountLabel())).toHaveValue("1.000"));
  });

  it("shows the credit the payments query holds, not the one captured at open", async () => {
    h.session = sessionOf(["view:payments:clinic", "create:payments:clinic"]);
    const queries = client();
    const view = render(panel(queries));
    fireEvent.click(await screen.findByRole("button", { name: ar.payments.panel.useCredit }));
    expect(await screen.findByText(available("2.000 KWD"))).toBeInTheDocument();
    // The patient's credit moved while the dialog was open.
    h.invoicePayments.mockResolvedValue({ creditBalanceMinor: "3000", movements });
    view.rerender(panel(queries, { ...invoice, version: 2 }));
    expect(await screen.findByText(available("3.000 KWD"))).toBeInTheDocument();
  });
});
