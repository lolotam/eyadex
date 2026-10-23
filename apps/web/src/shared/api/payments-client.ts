import type {
  CreateCreditApplicationRequest,
  CreatePaymentRequest,
  CreateRefundRequest,
  Payment,
  PaymentListQuery,
  Refund,
  RefundListQuery,
  refundListResponseSchema,
  refundWriteResponseSchema,
  creditApplicationResponseSchema,
  invoicePaymentsResponseSchema,
  paymentListResponseSchema,
  paymentWriteResponseSchema,
} from "@eyadex/contracts/finance";
import type { BranchOptionListResponse, OptionListQuery } from "@eyadex/contracts/role-admin";
import type { Persona } from "@eyadex/contracts/session";
import type { z } from "zod";

export type InvoicePayments = z.infer<typeof invoicePaymentsResponseSchema>;
export type PaymentWrite = z.infer<typeof paymentWriteResponseSchema>;
export type CreditApplication = z.infer<typeof creditApplicationResponseSchema>;
export type PaymentList = z.infer<typeof paymentListResponseSchema>;
export type RefundWrite = z.infer<typeof refundWriteResponseSchema>;
export type RefundList = z.infer<typeof refundListResponseSchema>;

/**
 * Finance F2 (docs/specs/finance-design.md §4.6): money in against one invoice, the patient's credit and
 * the receipts. Amounts are minor-unit strings; every write carries an `Idempotency-Key`.
 */
export interface PaymentsApi {
  /** The invoice's movements oldest first and the patient's credit; needs `view:payments` there. */
  invoicePayments(persona: Persona, invoiceId: string): Promise<InvoicePayments>;
  /** A retry with the same key replays the first receipt; another invoice or body is a conflict. */
  recordPayment(
    persona: Persona,
    invoiceId: string,
    input: CreatePaymentRequest,
    idempotencyKey: string,
  ): Promise<PaymentWrite>;
  applyCredit(
    persona: Persona,
    invoiceId: string,
    input: CreateCreditApplicationRequest,
    idempotencyKey: string,
  ): Promise<CreditApplication>;
  listPayments(persona: Persona, query: Partial<PaymentListQuery>): Promise<PaymentList>;
  getPayment(persona: Persona, paymentId: string): Promise<Payment>;
  /**
   * F2 card 2: money out of an invoice, from one of its payments or from the patient's credit; needs
   * `create:refunds` reaching the invoice's branch. A retry with the same key replays the first refund.
   */
  refund(
    persona: Persona,
    invoiceId: string,
    input: CreateRefundRequest,
    idempotencyKey: string,
  ): Promise<RefundWrite>;
  /** Refunds are read through `view:payments` (no view key of their own). */
  listRefunds(persona: Persona, query: Partial<RefundListQuery>): Promise<RefundList>;
  getRefund(persona: Persona, refundId: string): Promise<Refund>;
  /** The branches inside the caller's `view:payments` reach: the receipts' branch names and filter. */
  branchOptions(
    persona: Persona,
    query: Partial<OptionListQuery>,
  ): Promise<BranchOptionListResponse>;
}
