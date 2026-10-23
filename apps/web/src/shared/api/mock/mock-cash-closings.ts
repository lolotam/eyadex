import type { CashClosingsApi } from "../cash-closings-client";
import { getClosing, listClosings } from "./mock-cash-closing-reads";
import { closeCash, previewClosing } from "./mock-cash-closing-writes";
import { delay, getState, persist } from "./mock-store";

/** The `cashClosings` namespace of the mock: the API's checks in the API's order (F2 card 2b). */
export function createMockCashClosings(): CashClosingsApi {
  return {
    preview: async (p, branchId) => (
      await delay(),
      previewClosing(getState(), p, branchId, new Date())
    ),
    async close(p, input, key) {
      await delay();
      const result = closeCash(getState(), p, input, key, new Date());
      persist();
      return result;
    },
    list: async (p, q) => (await delay(), listClosings(getState(), p, q)),
    get: async (p, id) => (await delay(), getClosing(getState(), p, id)),
  };
}
