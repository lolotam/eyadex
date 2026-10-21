import type { PaymentsApi } from "../payments-client";
import { getPayment, invoicePayments, listPayments } from "./mock-payment-reads";
import { applyCredit, recordPayment } from "./mock-payment-writes";
import { delay, getState, persist } from "./mock-store";

/** Saves after a write that succeeded; a refused write leaves the stored state as it was. */
async function write<T>(run: () => T): Promise<T> {
  await delay();
  const result = run();
  persist();
  return result;
}

/** The `payments` namespace of the mock: the API's checks in the API's order (F2 card 1 §6). */
export function createMockPayments(): PaymentsApi {
  return {
    invoicePayments: async (p, id) => (await delay(), invoicePayments(getState(), p, id)),
    recordPayment: (p, id, input, key) =>
      write(() => recordPayment(getState(), p, id, input, key, new Date())),
    applyCredit: (p, id, input, key) =>
      write(() => applyCredit(getState(), p, id, input, key, new Date())),
    listPayments: async (p, q) => (await delay(), listPayments(getState(), p, q)),
    getPayment: async (p, id) => (await delay(), getPayment(getState(), p, id)),
  };
}
