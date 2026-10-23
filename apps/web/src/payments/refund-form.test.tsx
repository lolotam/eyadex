import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Invoice } from "@eyadex/contracts/finance";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { RefundForm, type RefundSource } from "./refund-form";

const h = vi.hoisted(() => ({ refund: vi.fn() }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: { kind: "clinic_admin", clinicId: "c", memberId: null } }),
}));
vi.mock("@/shared/api/api-provider", () => ({
  useApi: () => ({ payments: { refund: h.refund } }),
}));

const PAYMENT = "00000000-0000-7000-8000-00000000000b";
const invoice = {
  id: "00000000-0000-7000-8000-00000000000a",
  number: "TT-2026-000001",
  status: "issued",
  currency: "KWD",
  currencyExponent: 3,
  settlement: { state: "paid", paidMinor: "4000", owedMinor: "0" },
} as unknown as Invoice;
const fromPayment: RefundSource = {
  kind: "payment",
  paymentId: PAYMENT,
  receiptNumber: "TT-R-2026-000001",
  capMinor: "3000",
};

const form = (source: RefundSource) => (
  <QueryClientProvider client={new QueryClient()}>
    <I18nProvider>
      <RefundForm
        invoice={invoice}
        source={source}
        methods={["cash", "knet"]}
        keyOf={() => "00000000-0000-4000-8000-000000000002"}
        onDone={() => undefined}
      />
    </I18nProvider>
  </QueryClientProvider>
);
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } });
const submit = () =>
  fireEvent.click(screen.getByRole("button", { name: ar.payments.refund.submit }));

beforeEach(() => h.refund.mockReset());
afterEach(() => cleanup());

describe("the refund form (card 2a §2)", () => {
  it("warns that the invoice owes the amount again for a receipt refund only", () => {
    render(form(fromPayment));
    expect(screen.getByText(ar.payments.refund.owesAgain)).toBeInTheDocument();
    cleanup();
    render(form({ kind: "credit", capMinor: "3000" }));
    expect(screen.queryByText(ar.payments.refund.owesAgain)).toBeNull();
  });

  it("refuses above the receipt's refundable amount before sending", async () => {
    render(form(fromPayment));
    type(ar.payments.refund.reason, "خطأ");
    type("المبلغ", "3.001");
    submit();
    expect(await screen.findByText(ar.errors.refund_exceeds_available)).toBeInTheDocument();
    expect(h.refund).not.toHaveBeenCalled();
  });

  it("needs a reason, then sends the receipt source with its id", async () => {
    h.refund.mockResolvedValue({ refund: { refundNumber: "TT-RF-2026-000001" } });
    render(form(fromPayment));
    submit();
    expect(await screen.findByText(ar.validation.required)).toBeInTheDocument();
    expect(h.refund).not.toHaveBeenCalled();
    type(ar.payments.refund.reason, "خطأ");
    submit();
    await waitFor(() => expect(h.refund).toHaveBeenCalledTimes(1));
    expect(h.refund.mock.calls[0]![2]).toEqual({
      source: "payment",
      paymentId: PAYMENT,
      amountMinor: "3000",
      method: "cash",
      reason: "خطأ",
    });
  });
});
