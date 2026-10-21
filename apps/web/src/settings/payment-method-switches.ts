import {
  PAYMENT_METHODS,
  type FinanceSettings,
  type PaymentMethod,
} from "@eyadex/contracts/finance";

export type Switches = Record<PaymentMethod, boolean>;

/** Absent means all four on, as the API reads "no saved switch = on" (spec §4.6). */
export function switchesOf(settings: Pick<FinanceSettings, "paymentMethods">): Switches {
  const saved = new Map((settings.paymentMethods ?? []).map((m) => [m.method, m.enabled]));
  return Object.fromEntries(PAYMENT_METHODS.map((m) => [m, saved.get(m) ?? true])) as Switches;
}
