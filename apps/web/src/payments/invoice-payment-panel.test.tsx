import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Invoice } from "@eyadex/contracts/finance";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { InvoicePaymentPanel } from "./invoice-payment-panel";

const h = vi.hoisted(() => ({
  session: { permissions: [] as string[], allBranches: false, branchIds: [] as string[] },
  invoicePayments: vi.fn(),
}));
vi.mock("@/shared/persona/persona-provider", () => ({
  useSession: () => ({ session: h.session }),
  usePersona: () => ({
    persona: { kind: "clinic_admin", clinicId: "c", memberId: null },
    ready: true,
  }),
}));
vi.mock("@/shared/api/api-provider", () => ({
  useApi: () => ({ payments: { invoicePayments: h.invoicePayments } }),
}));
vi.mock("@/shared/money/use-clinic-money", () => ({
  useFinanceSettings: () => ({ data: undefined }),
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
  settlement: { state: "partly_paid", paidMinor: "1000", owedMinor: "4000" },
} as unknown as Invoice;

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <InvoicePaymentPanel invoice={invoice} onChanged={() => undefined} />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
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
