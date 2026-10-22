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

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const panel = (queries: QueryClient, shown: Invoice = invoice) => (
  <QueryClientProvider client={queries}>
    <I18nProvider>
      <InvoicePaymentPanel invoice={shown} onChanged={() => undefined} />
    </I18nProvider>
  </QueryClientProvider>
);
const amountLabel = () => ar.payments.dialog.amount.replace("{currency}", "KWD");
const sessionOf = (permissions: string[]) => ({ permissions, allBranches: false, branchIds: [] });

function show() {
  return render(panel(client()));
}

beforeEach(() => {
  h.settings = { data: undefined };
  h.recordPayment.mockReset();
  h.applyCredit.mockReset();
  h.invoicePayments.mockReset();
  h.invoicePayments.mockResolvedValue({
    invoiceId: invoice.id,
    currency: "KWD",
    currencyExponent: 3,
    settlement: invoice.settlement,
    creditBalanceMinor: "2000",
    movements: [
      {
        kind: "payment",
        paymentId: "00000000-0000-7000-8000-0000000000b1",
        receiptNumber: "TT-R-2026-000001",
        method: "cash",
        amountMinor: "1000",
        refundableMinor: "1000",
        at: "2026-10-20T08:00:00.000Z",
        by: "00000000-0000-7000-8000-0000000000c1",
      },
    ],
  });
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
  beforeEach(() => {
    h.session = { permissions: ["create:payments:clinic"], allBranches: false, branchIds: [] };
  });

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
    h.session = { permissions: ["create:payments:clinic"], allBranches: false, branchIds: [] };
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
  it("a failed request, reopened with the same values after a version change, sends the same key", async () => {
    h.session = { permissions: ["create:payments:clinic"], allBranches: false, branchIds: [] };
    h.recordPayment.mockRejectedValueOnce(new ApiError("unknown"));
    h.recordPayment.mockResolvedValueOnce({ payment: { receiptNumber: "TT-R-2026-000002" } });
    const queries = client();
    const view = render(panel(queries));
    const submitOnce = async () => {
      fireEvent.click(screen.getByRole("button", { name: ar.payments.panel.record }));
      fireEvent.click(await screen.findByRole("button", { name: ar.payments.dialog.submit }));
    };
    await submitOnce();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    view.rerender(panel(queries, { ...invoice, version: 2 }));
    await submitOnce();
    await waitFor(() => expect(h.recordPayment).toHaveBeenCalledTimes(2));
    expect(h.recordPayment.mock.calls[1]![3]).toBe(h.recordPayment.mock.calls[0]![3]);
  });

  it("a failed request, then a higher paid amount, sends a different key", async () => {
    h.session = { permissions: ["create:payments:clinic"], allBranches: false, branchIds: [] };
    h.recordPayment.mockRejectedValueOnce(new ApiError("unknown"));
    h.recordPayment.mockResolvedValueOnce({ payment: { receiptNumber: "TT-R-2026-000002" } });
    const queries = client();
    const view = render(panel(queries));
    // The same amount both times, so only the invoice's paid amount tells the two requests apart.
    const submitOnce = async () => {
      fireEvent.click(screen.getByRole("button", { name: ar.payments.panel.record }));
      fireEvent.change(await screen.findByLabelText(amountLabel()), { target: { value: "1.000" } });
      fireEvent.click(await screen.findByRole("button", { name: ar.payments.dialog.submit }));
    };
    await submitOnce();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    view.rerender(
      panel(queries, {
        ...invoice,
        totalMinor: "7000",
        settlement: { state: "partly_paid", paidMinor: "5000", owedMinor: "2000" },
      }),
    );
    await submitOnce();
    await waitFor(() => expect(h.recordPayment).toHaveBeenCalledTimes(2));
    expect(h.recordPayment.mock.calls[1]![3]).not.toBe(h.recordPayment.mock.calls[0]![3]);
  });

  it("a failed request, then another invoice, sends a different key", async () => {
    h.session = { permissions: ["create:payments:clinic"], allBranches: false, branchIds: [] };
    h.recordPayment.mockRejectedValueOnce(new ApiError("unknown"));
    h.recordPayment.mockResolvedValueOnce({ payment: { receiptNumber: "TT-R-2026-000002" } });
    const queries = client();
    const view = render(panel(queries));
    const submitOnce = async () => {
      fireEvent.click(screen.getByRole("button", { name: ar.payments.panel.record }));
      fireEvent.click(await screen.findByRole("button", { name: ar.payments.dialog.submit }));
    };
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
    h.session = { permissions: ["view:payments:clinic"], allBranches: false, branchIds: [] };
    const queries = client();
    const view = render(panel(queries));
    await waitFor(() => expect(h.invoicePayments).toHaveBeenCalledTimes(1));
    view.rerender(panel(queries, { ...invoice, version: 2 }));
    await waitFor(() => expect(h.invoicePayments).toHaveBeenCalledTimes(2));
  });
});

// PR #111 review: the dialog follows the invoice, so a refetch with a higher paid amount warns.
describe("the dialog after the invoice moved", () => {
  const moved = {
    ...invoice,
    totalMinor: "7000",
    settlement: { state: "partly_paid", paidMinor: "5000", owedMinor: "2000" },
  } as unknown as Invoice;

  it("warns and prefills the new owed amount after an unclear failure", async () => {
    h.session = sessionOf(["create:payments:clinic"]);
    h.recordPayment.mockRejectedValueOnce(new ApiError("unknown"));
    const queries = client();
    const view = render(panel(queries));
    fireEvent.click(screen.getByRole("button", { name: ar.payments.panel.record }));
    fireEvent.click(await screen.findByRole("button", { name: ar.payments.dialog.submit }));
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
});
