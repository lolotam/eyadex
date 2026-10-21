import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FinanceSettings } from "@eyadex/contracts/finance";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { PaymentMethodsCard } from "./payment-methods-card";

const h = vi.hoisted(() => ({ setPaymentMethods: vi.fn() }));
vi.mock("@/shared/api/api-provider", () => ({
  useApi: () => ({ finance: { setPaymentMethods: h.setPaymentMethods } }),
}));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: { kind: "clinic_admin", clinicId: "c", memberId: null } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => cleanup());

const base = {
  currency: "KWD",
  currencyExponent: 3,
  taxRateBp: 0,
  commercialRegNo: null,
  hasLogo: false,
} as FinanceSettings;
const withMethods = (on: Record<string, boolean>): FinanceSettings => ({
  ...base,
  paymentMethods: (["cash", "knet", "bank_transfer", "other"] as const).map((method) => ({
    method,
    enabled: on[method] ?? true,
  })),
});

function show(settings: FinanceSettings, editable = true) {
  const client = new QueryClient();
  const ui = (s: FinanceSettings) => (
    <QueryClientProvider client={client}>
      <I18nProvider>
        <PaymentMethodsCard settings={s} editable={editable} />
      </I18nProvider>
    </QueryClientProvider>
  );
  const view = render(ui(settings));
  return { rerender: (s: FinanceSettings) => view.rerender(ui(s)) };
}
const switchOf = (label: string) => screen.getByRole("switch", { name: label });

describe("the payment methods card", () => {
  it("disables the last switch that is on", () => {
    show(withMethods({ cash: true, knet: false, bank_transfer: false, other: false }));
    expect(switchOf(ar.payments.method.cash)).toBeDisabled();
    expect(switchOf(ar.payments.method.knet)).not.toBeDisabled();
  });

  it("is read-only without the settings key and has no save", () => {
    show(withMethods({}), false);
    expect(switchOf(ar.payments.method.other)).toBeDisabled();
    expect(screen.queryByRole("button", { name: ar.payments.methods.save })).toBeNull();
  });

  it("a refetch never resets unsaved switches; one save sends all four", async () => {
    h.setPaymentMethods.mockResolvedValue({ paymentMethods: [] });
    const view = show(withMethods({}));
    fireEvent.click(switchOf(ar.payments.method.other));
    view.rerender(withMethods({ cash: false }));
    expect(switchOf(ar.payments.method.other)).not.toBeChecked();
    expect(switchOf(ar.payments.method.cash)).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: ar.payments.methods.save }));
    await waitFor(() =>
      expect(h.setPaymentMethods).toHaveBeenCalledWith(expect.anything(), [
        { method: "cash", enabled: true },
        { method: "knet", enabled: true },
        { method: "bank_transfer", enabled: true },
        { method: "other", enabled: false },
      ]),
    );
  });
});
