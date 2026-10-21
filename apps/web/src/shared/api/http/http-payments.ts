import {
  creditApplicationResponseSchema,
  invoicePaymentsResponseSchema,
  paymentListResponseSchema,
  paymentResponseSchema,
  paymentWriteResponseSchema,
} from "@eyadex/contracts/finance";
import { branchOptionListResponseSchema } from "@eyadex/contracts/role-admin";
import type { PaymentsApi } from "../payments-client";
import type { HttpContext } from "./http-context";

/** Spec §4.6 routes; every answer is parsed by its contract schema before a screen sees it. */
export function createHttpPayments({ transport }: HttpContext): PaymentsApi {
  const id = encodeURIComponent;
  return {
    invoicePayments: (_persona, invoiceId) =>
      transport.send("GET", `/v1/invoices/${id(invoiceId)}/payments`, {
        schema: invoicePaymentsResponseSchema,
      }),
    recordPayment: (_persona, invoiceId, input, idempotencyKey) =>
      transport.send("POST", `/v1/invoices/${id(invoiceId)}/payments`, {
        schema: paymentWriteResponseSchema,
        body: input,
        idempotencyKey,
      }),
    applyCredit: (_persona, invoiceId, input, idempotencyKey) =>
      transport.send("POST", `/v1/invoices/${id(invoiceId)}/credit-applications`, {
        schema: creditApplicationResponseSchema,
        body: input,
        idempotencyKey,
      }),
    listPayments: (_persona, query) =>
      transport.send("GET", "/v1/payments", { schema: paymentListResponseSchema, query }),
    async getPayment(_persona, paymentId) {
      const answer = await transport.send("GET", `/v1/payments/${id(paymentId)}`, {
        schema: paymentResponseSchema,
      });
      return answer.payment;
    },
    branchOptions: (_persona, query) =>
      transport.send("GET", "/v1/payments/branch-options", {
        schema: branchOptionListResponseSchema,
        query,
      }),
  };
}
