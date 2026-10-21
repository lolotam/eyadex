import { z } from "zod";
import { idSchema } from "./common.ts";
import { invoiceSettlementSchema } from "./finance-invoice.ts";
import { dateSchema } from "./finance-list.ts";
import { cashSeqSchema, paymentListQuerySchema, paymentMethodSchema } from "./finance-payments.ts";
import { requiredText } from "./finance-text.ts";
import {
  currencyCodeSchema,
  minorAmountSchema,
  positiveMinorAmountSchema,
  readMinor,
} from "./money.ts";

/**
 * `POST /v1/invoices/:id/refunds`: a payment refund reopens its balance; a credit refund consumes
 * patient credit. Only the payment variant names a payment, so the source cannot be ambiguous.
 */
export const createRefundRequestSchema = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("payment"),
      paymentId: idSchema,
      amountMinor: positiveMinorAmountSchema,
      method: paymentMethodSchema,
      reason: requiredText(300),
    })
    .strict(),
  z
    .object({
      source: z.literal("credit"),
      amountMinor: positiveMinorAmountSchema,
      method: paymentMethodSchema,
      reason: requiredText(300),
    })
    .strict(),
]);
export type CreateRefundRequest = z.infer<typeof createRefundRequestSchema>;

/** Every refund is numbered; its method is independent of the original receipt's method. */
export const refundSchema = z
  .object({
    id: idSchema,
    refundNumber: z.string(),
    branchId: idSchema,
    invoiceId: idSchema,
    invoiceNumber: z.string(),
    patientId: idSchema,
    patientName: z.string(),
    method: paymentMethodSchema,
    amountMinor: positiveMinorAmountSchema,
    currency: currencyCodeSchema,
    currencyExponent: z.number().int(),
    reason: requiredText(300),
    refundedAt: z.string().datetime(),
    businessDate: dateSchema,
    cashSeq: cashSeqSchema.nullable(),
    refundedBy: idSchema,
  })
  .strict()
  .refine((v) => (v.method === "cash") === (v.cashSeq !== null), {
    path: ["cashSeq"],
    message: "validation.required",
  });
export type Refund = z.infer<typeof refundSchema>;

/** A void invoice has no settlement, but refunding its released credit still changes the balance. */
export const refundWriteResponseSchema = z
  .object({
    refund: refundSchema,
    settlement: invoiceSettlementSchema.nullable(),
    creditBalanceMinor: minorAmountSchema,
  })
  .strict();

/** Releases preserve why money left an invoice without prescribing the later settlement algorithm. */
export const creditReleaseCauseSchema = z.enum(["invoice_edited", "invoice_voided", "refund"]);

/** The two amounts the refundable rule reads, so the rule sees only what it compares. */
type RefundableShape = {
  readonly kind: string;
  readonly amountMinor: string;
  readonly refundableMinor?: string | undefined;
};

/**
 * #91: a payment movement's refundable amount never exceeds what was paid — the refund dialog caps at this
 * value, so it must never promise more than was paid.
 */
const refundableWithinPayment = (movement: RefundableShape, ctx: z.RefinementCtx): void => {
  if (movement.kind !== "payment") return;
  const amount = readMinor(movement.amountMinor);
  const refundable = readMinor(movement.refundableMinor ?? "");
  if (amount === null || refundable === null) return;
  if (refundable <= amount) return;
  ctx.addIssue({ code: "custom", path: ["refundableMinor"], message: "validation.amount" });
};

/** Stable movement ids let the invoice history distinguish receipts, credit and refunds. */
const invoicePaymentMovementUnion = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("payment"),
      paymentId: idSchema,
      receiptNumber: z.string(),
      method: paymentMethodSchema,
      amountMinor: positiveMinorAmountSchema,
      refundableMinor: minorAmountSchema,
      at: z.string().datetime(),
      by: idSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("credit_applied"),
      allocationId: idSchema,
      creditId: idSchema,
      amountMinor: positiveMinorAmountSchema,
      at: z.string().datetime(),
      by: idSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("credit_released"),
      creditId: idSchema,
      originAllocationId: idSchema,
      amountMinor: positiveMinorAmountSchema,
      cause: creditReleaseCauseSchema,
      at: z.string().datetime(),
      by: idSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("refund"),
      refundId: idSchema,
      refundNumber: z.string(),
      method: paymentMethodSchema,
      amountMinor: positiveMinorAmountSchema,
      reason: requiredText(300),
      at: z.string().datetime(),
      by: idSchema,
    })
    .strict(),
]);

export const invoicePaymentMovementSchema =
  invoicePaymentMovementUnion.superRefine(refundableWithinPayment);
export type InvoicePaymentMovement = z.infer<typeof invoicePaymentMovementSchema>;

/** `GET /v1/invoices/:id/payments` returns movements oldest first and clinic-wide patient credit. */
export const invoicePaymentsResponseSchema = z
  .object({
    invoiceId: idSchema,
    currency: currencyCodeSchema,
    currencyExponent: z.number().int(),
    settlement: invoiceSettlementSchema.nullable(),
    creditBalanceMinor: minorAmountSchema,
    movements: z.array(invoicePaymentMovementSchema),
  })
  .strict();

/** Refund filters mirror receipt filters, without a receipt-number search. */
export const refundListQuerySchema = paymentListQuerySchema.omit({ receiptNumber: true }).strict();
export type RefundListQuery = z.infer<typeof refundListQuerySchema>;

/** Refund history is paginated independently of the invoice history. */
export const refundListResponseSchema = z
  .object({
    items: z.array(refundSchema),
    nextCursor: z.string().nullable(),
    total: z.number().int().nonnegative(),
  })
  .strict();

/** `GET /v1/refunds/:id` can display a numbered refund even when its invoice has been voided. */
export const refundResponseSchema = z.object({ refund: refundSchema }).strict();
