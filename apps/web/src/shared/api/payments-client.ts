import type {
  CreateCreditApplicationRequest,
  CreatePaymentRequest,
  Payment,
  PaymentListQuery,
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
  /** The branches inside the caller's `view:payments` reach: the receipts' branch names and filter. */
  branchOptions(
    persona: Persona,
    query: Partial<OptionListQuery>,
  ): Promise<BranchOptionListResponse>;
}
