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
/** A second receipt: the invoice gained a movement. */
const second = {
  kind: "payment",
  paymentId: "00000000-0000-7000-8000-0000000000b2",
  receiptNumber: "TT-R-2026-000002",
  method: "cash",
  amountMinor: "4000",
  at: "2026-10-20T08:30:00.000Z",
};

/** The movements after the lost request was recorded and then refunded; the net paid amount stayed. */
const refunded = [
  ...movements,
  second,
  {
    kind: "refund",
    refundId: "00000000-0000-7000-8000-0000000000c3",
    refundNumber: "TT-RF-2026-000002",
    method: "cash",
    amountMinor: "4000",
    reason: "test",
    at: "2026-10-20T09:00:00.000Z",
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
/** The answer of the payments query: the settlement and the movements of ONE read. */
const answer = (paidMinor: string, owedMinor: string, moves: unknown[]) => ({
  creditBalanceMinor: "2000",
  movements: moves,
  settlement: { state: "partly_paid", paidMinor, owedMinor },
});
/** Opens the record-payment dialog — its button waits for the payments query — and sends it. */
const submitOnce = async (amount?: string) => {
  const button = await screen.findByRole("button", { name: ar.payments.panel.record });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  const field = await screen.findByLabelText(amountLabel());
  if (amount) fireEvent.change(field, { target: { value: amount } });
  fireEvent.click(await screen.findByRole("button", { name: ar.payments.dialog.submit }));
};
/** Closes the open dialog and waits until it is gone. */
const close = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
};

beforeEach(() => {
  h.settings = { data: undefined };
  h.session = sessionOf(["view:payments:clinic", "create:payments:clinic"]);
  h.recordPayment.mockReset();
  h.applyCredit.mockReset();
  h.invoicePayments.mockReset();
  h.invoicePayments.mockResolvedValue(answer("1000", "4000", movements));
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
    await close();
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
    await submitOnce("1.000");
    await waitFor(() => expect(h.recordPayment).toHaveBeenCalledTimes(1));
    const first = h.recordPayment.mock.calls[0]![3];
    // The failed send refetched the payments: waiting for that refetch keeps the new answer out of it.
    await waitFor(() => expect(h.invoicePayments).toHaveBeenCalledTimes(2));
    // The invoice moved: the payments query answers with the paid amount and the movement of it.
    h.invoicePayments.mockResolvedValue(answer("5000", "2000", [...movements, second]));
    view.rerender(panel(queries, { ...moved, version: 2 }));
    expect(await screen.findByText(ar.payments.paidChangedNotice)).toBeInTheDocument();
    await close();
    await submitOnce("1.000");
    await waitFor(() => expect(h.recordPayment).toHaveBeenCalledTimes(2));
    const replacement = h.recordPayment.mock.calls[1]![3];
    expect(replacement).not.toBe(first);
    // The retry after it reuses the replacement, so the API replays it instead of paying twice.
    await close();
    await submitOnce("1.000");
    await waitFor(() => expect(h.recordPayment).toHaveBeenCalledTimes(3));
    expect(h.recordPayment.mock.calls[2]![3]).toBe(replacement);
  });

  // PR #111 review: a recorded and refunded payment leaves the net as it was: the movements show it.
  it("replaces the key when a payment was recorded and then refunded", async () => {
    h.recordPayment.mockRejectedValue(new ApiError("unknown"));
    const queries = client();
    const view = render(panel(queries));
    // The movements are read before the send, so the key is minted under the invoice as it is.
    expect(
      await screen.findByText(ar.payments.movement.payment.replace("{number}", "TT-R-2026-000001")),
    ).toBeInTheDocument();
    await submitOnce();
    await waitFor(() => expect(h.recordPayment).toHaveBeenCalledTimes(1));
    const first = h.recordPayment.mock.calls[0]![3];
    // The failed send refetches the movements: waiting for that refetch keeps the new movements out
    // of it, so only the refetch after the version bump can show the recorded payment.
    await waitFor(() => expect(h.invoicePayments).toHaveBeenCalledTimes(2));
    // The payment was recorded and refunded: the paid amount stayed, the invoice gained two movements.
    h.invoicePayments.mockResolvedValue(answer("1000", "4000", refunded));
    view.rerender(panel(queries, { ...invoice, version: 2 }));
    expect(await screen.findByText(ar.payments.paidChangedNotice)).toBeInTheDocument();
    await close();
    await submitOnce();
    await waitFor(() => expect(h.recordPayment).toHaveBeenCalledTimes(2));
    expect(h.recordPayment.mock.calls[1]![3]).not.toBe(first);
  });

  // PR #111 review: no key before a real baseline: the query answers the money state the key binds to.
  it("keeps the record action off until the query has answered once", () => {
    h.invoicePayments.mockReturnValue(new Promise(() => undefined));
    render(panel(client()));
    expect(screen.getByRole("button", { name: ar.payments.panel.record })).toBeDisabled();
    // The patient's credit is only known from that answer, so the credit action is not offered.
    expect(screen.queryByRole("button", { name: ar.payments.panel.useCredit })).toBeNull();
  });

  // PR #111 review: the paid amount and the movements come from one answer: one move, one rotation.
  it("rotates the key once when the invoice and the query refresh separately", async () => {
    h.recordPayment.mockRejectedValue(new ApiError("unknown"));
    const queries = client();
    const view = render(panel(queries));
    await submitOnce("1.000");
    await waitFor(() => expect(h.recordPayment).toHaveBeenCalledTimes(1));
    const first = h.recordPayment.mock.calls[0]![3];
    // The invoice page refreshed on its own: the key reads the query, so its paid amount moves nothing.
    view.rerender(panel(queries, moved));
    await close();
    await submitOnce("1.000");
    await waitFor(() => expect(h.recordPayment).toHaveBeenCalledTimes(2));
    // The same request under the same money state: the key is the one the failed send held.
    expect(h.recordPayment.mock.calls[1]![3]).toBe(first);
    // The failed send refetched the payments: waiting for it keeps the new answer out of it.
    await waitFor(() => expect(h.invoicePayments).toHaveBeenCalledTimes(3));
    // The payments query then answers with the invoice as it is now: the invoice moved once.
    h.invoicePayments.mockResolvedValue(answer("5000", "2000", [...movements, second]));
    view.rerender(panel(queries, { ...moved, version: 2 }));
    expect(await screen.findByText(ar.payments.paidChangedNotice)).toBeInTheDocument();
    await close();
    await submitOnce("1.000");
    await waitFor(() => expect(h.recordPayment).toHaveBeenCalledTimes(3));
    // One rotation: the moved invoice gets a key of its own, and the sends after it reuse it.
    expect(h.recordPayment.mock.calls[2]![3]).not.toBe(first);
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
    await waitFor(() => expect(h.invoicePayments).toHaveBeenCalledTimes(2));
    // The invoice moved: the payments query answers with the invoice as it is now.
    h.invoicePayments.mockResolvedValue(answer("5000", "2000", [...movements, second]));
    view.rerender(panel(queries, { ...moved, version: 2 }));
    expect(await screen.findByText(ar.payments.paidChangedNotice)).toBeInTheDocument();
    expect(screen.getByLabelText(amountLabel())).toHaveValue("2.000");
  });

  it("warns on the credit dialog too", async () => {
    h.applyCredit.mockRejectedValueOnce(new ApiError("unknown"));
    const queries = client();
    const view = render(panel(queries));
    fireEvent.click(await screen.findByRole("button", { name: ar.payments.panel.useCredit }));
    fireEvent.click(await screen.findByRole("button", { name: ar.payments.dialog.apply }));
    await waitFor(() => expect(h.applyCredit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(h.invoicePayments).toHaveBeenCalledTimes(2));
    h.invoicePayments.mockResolvedValue(answer("5000", "2000", [...movements, second]));
    view.rerender(panel(queries, { ...moved, version: 2 }));
    expect(await screen.findByText(ar.payments.paidChangedNotice)).toBeInTheDocument();
  });
});

// PR #111 review: the dialog belongs to its invoice, and the credit is the one the query answered.
describe("the dialog and the invoice on screen", () => {
  it("keeps the credit the query last showed while it refetches", async () => {
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
    const queries = client();
    const view = render(panel(queries));
    expect(
      await screen.findByRole("button", { name: ar.payments.panel.useCredit }),
    ).toBeInTheDocument();
    // Its query starts over: the credit read for the first invoice is not offered on this one.
    h.invoicePayments.mockReturnValue(new Promise(() => undefined));
    view.rerender(panel(queries, { ...invoice, id: "00000000-0000-7000-8000-00000000000d" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: ar.payments.panel.useCredit })).toBeNull(),
    );
  });
});
