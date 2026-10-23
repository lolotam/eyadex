import {
  cashClosingListResponseSchema,
  cashClosingPreviewResponseSchema,
  cashClosingResponseSchema,
} from "@eyadex/contracts/finance";
import type { CashClosingsApi } from "../cash-closings-client";
import type { HttpContext } from "./http-context";

/** Spec §4.6 closing routes; every answer is parsed by its contract schema before a screen sees it. */
export function createHttpCashClosings({ transport }: HttpContext): CashClosingsApi {
  return {
    preview: (_persona, branchId) =>
      transport.send("GET", "/v1/cash-closings/preview", {
        schema: cashClosingPreviewResponseSchema,
        query: { branchId },
      }),
    async close(_persona, input, idempotencyKey) {
      const answer = await transport.send("POST", "/v1/cash-closings", {
        schema: cashClosingResponseSchema,
        body: input,
        idempotencyKey,
      });
      return answer.cashClosing;
    },
    list: (_persona, query) =>
      transport.send("GET", "/v1/cash-closings", { schema: cashClosingListResponseSchema, query }),
    async get(_persona, closingId) {
      const answer = await transport.send(
        "GET",
        `/v1/cash-closings/${encodeURIComponent(closingId)}`,
        { schema: cashClosingResponseSchema },
      );
      return answer.cashClosing;
    },
  };
}
