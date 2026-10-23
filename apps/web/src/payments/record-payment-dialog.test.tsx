import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Invoice, PaymentMethod } from "@eyadex/contracts/finance";
import { ApiError } from "@/shared/api/api-error";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { ApplyCreditForm } from "./apply-credit-dialog";
import { useHeldKeys } from "./idempotency-key";
import { RecordPaymentForm } from "./record-payment-dialog";

const h = vi.hoisted(() => ({ recordPayment: vi.fn(), applyCredit: vi.fn() }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: { kind: "clinic_admin", clinicId: "c", memberId: null } }),
}));
vi.mock("@/shared/api/api-provider", () => ({
  useApi: () => ({ payments: { recordPayment: h.recordPayment, applyCredit: h.applyCredit } }),
}));

const invoice = {
  id: "00000000-0000-7000-8000-00000000000a",
  number: "TT-2026-000001",
  status: "issued",
  currency: "KWD",
  currencyExponent: 3,
  settlement: { state: "unpaid", paidMinor: "0", owedMinor: "4000" },
} as unknown as Invoice;

const client = new QueryClient();
const form = (methods: PaymentMethod[]) => (
  <QueryClientProvider client={client}>
    <I18nProvider>
      <RecordPaymentForm
        invoice={invoice}
        methods={methods}
        keyOf={() => "00000000-0000-4000-8000-000000000001"}
        onDone={() => undefined}
      />
    </I18nProvider>
  </QueryClientProvider>
);

/** The panel's shape: the held key lives above the form, so it survives an unclear failure. */
function HeldForm({ shown }: { shown: Invoice }) {
  const keys = useHeldKeys({
    invoiceId: shown.id,
    paidMinor: shown.settlement?.paidMinor ?? "0",
  });
  return (
    <RecordPaymentForm
      invoice={shown}
      methods={["cash"]}
      keyOf={(request) => keys.keyOf("pay", request)}
      paidChanged={keys.paidChanged.pay}
      onDone={() => keys.drop("pay")}
    />
  );
}

const held = (shown: Invoice = invoice) => (
  <QueryClientProvider client={client}>
    <I18nProvider>
      <HeldForm shown={shown} />
    </I18nProvider>
  </QueryClientProvider>
);

beforeEach(() => {
  h.recordPayment.mockReset();
  h.applyCredit.mockReset();
});
afterEach(() => cleanup());

// PR #103 review: the form opened on one set of switches; a method turned off since then is never sent.
describe("the record-payment form's method", () => {
  it("falls back to the first enabled method when the selected one is no longer on", async () => {
    h.recordPayment.mockResolvedValue({ payment: { receiptNumber: "TT-R-2026-000001" } });
    const view = render(form(["cash", "knet"]));
    view.rerender(form(["knet", "bank_transfer"]));
    fireEvent.click(screen.getByRole("button", { name: ar.payments.dialog.submit }));
    await waitFor(() => expect(h.recordPayment).toHaveBeenCalledTimes(1));
    expect(h.recordPayment.mock.calls[0]![2]).toMatchObject({ method: "knet" });
  });
});

// PR #108: the paid amount moved after an unclear failure, so a payment may already be recorded.
describe("the warning before sending again", () => {
  const amountLabel = ar.payments.dialog.amount.replace("{currency}", "KWD");
  // The same invoice after a payment was recorded on it: the paid amount is higher, the debt lower.
  const refreshed = {
    ...invoice,
    settlement: { state: "partly_paid", paidMinor: "1000", owedMinor: "3000" },
  } as unknown as Invoice;
  const send = () => {
    fireEvent.change(screen.getByLabelText(amountLabel), { target: { value: "1.000" } });
    fireEvent.click(screen.getByRole("button", { name: ar.payments.dialog.submit }));
  };

  it("warns when the paid amount moved, and the next send uses a new key", async () => {
    h.recordPayment.mockRejectedValueOnce(new ApiError("unknown"));
    h.recordPayment.mockResolvedValueOnce({ payment: { receiptNumber: "TT-R-2026-000002" } });
    const view = render(held());
    send();
    await waitFor(() => expect(h.recordPayment).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(ar.payments.paidChangedNotice)).toBeNull();
    view.rerender(held(refreshed));
    expect(await screen.findByText(ar.payments.paidChangedNotice)).toBeInTheDocument();
    send();
    await waitFor(() => expect(h.recordPayment).toHaveBeenCalledTimes(2));
    expect(h.recordPayment.mock.calls[1]![3]).not.toBe(h.recordPayment.mock.calls[0]![3]);
  });

  it("warns nothing when the paid amount did not move, and the same key is reused", async () => {
    h.recordPayment.mockRejectedValueOnce(new ApiError("unknown"));
    h.recordPayment.mockResolvedValueOnce({ payment: { receiptNumber: "TT-R-2026-000002" } });
    const view = render(held());
    send();
    await waitFor(() => expect(h.recordPayment).toHaveBeenCalledTimes(1));
    view.rerender(held({ ...invoice, version: 2 }));
    expect(screen.queryByText(ar.payments.paidChangedNotice)).toBeNull();
    send();
    await waitFor(() => expect(h.recordPayment).toHaveBeenCalledTimes(2));
    expect(h.recordPayment.mock.calls[1]![3]).toBe(h.recordPayment.mock.calls[0]![3]);
  });

  it("the warning is gone after a successful send", async () => {
    h.recordPayment.mockRejectedValueOnce(new ApiError("unknown"));
    h.recordPayment.mockResolvedValueOnce({ payment: { receiptNumber: "TT-R-2026-000002" } });
    const view = render(held());
    send();
    await waitFor(() => expect(h.recordPayment).toHaveBeenCalledTimes(1));
    view.rerender(held(refreshed));
    expect(await screen.findByText(ar.payments.paidChangedNotice)).toBeInTheDocument();
    send();
    await waitFor(() => expect(h.recordPayment).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(ar.payments.paidChangedNotice)).toBeNull());
  });

  it("the credit form warns as well", () => {
    render(
      <QueryClientProvider client={client}>
        <I18nProvider>
          <ApplyCreditForm
            invoice={invoice}
            creditMinor="2000"
            keyOf={() => "00000000-0000-4000-8000-000000000001"}
            paidChanged
            onDone={() => undefined}
          />
        </I18nProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText(ar.payments.paidChangedNotice)).toBeInTheDocument();
  });
});
