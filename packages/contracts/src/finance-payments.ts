import { z } from "zod";
import { idSchema } from "./common.ts";
import { invoiceSettlementSchema } from "./finance-invoice.ts";
import { dateSchema } from "./finance-list.ts";
import { text } from "./finance-text.ts";
import { currencyCodeSchema, minorAmountSchema, positiveMinorAmountSchema } from "./money.ts";

/** A fixed order keeps settings and receipt method choices consistent across clients. */
export const PAYMENT_METHODS = ["cash", "knet", "bank_transfer", "other"] as const;

/** One receipt has one method; split tenders are separate payments. */
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

/** Settings retain disabled methods so historical receipts can still name them. */
export const paymentMethodSettingSchema = z
  .object({ method: paymentMethodSchema, enabled: z.boolean() })
  .strict();

/** Every reader gets every method, enabled or not, so a short list is a broken answer. */
export const paymentMethodSettingsSchema = z
  .array(paymentMethodSettingSchema)
  .min(PAYMENT_METHODS.length, "validation.required")
  .max(PAYMENT_METHODS.length, "validation.tooLong")
  .refine(
    (items) => new Set(items.map((i) => i.method)).size === items.length,
    "validation.duplicate",
  );

/**
 * `PUT /v1/clinic/settings/payment-methods` replaces all four settings. Whether one stays enabled
 * is a use-case rule (`payment_methods_empty`), not a validation error.
 */
export const paymentMethodsRequestSchema = z
  .object({
    paymentMethods: paymentMethodSettingsSchema,
  })
  .strict();
export type PaymentMethodsRequest = z.infer<typeof paymentMethodsRequestSchema>;

/** The saved settings include every method, even when a method is disabled. */
export const paymentMethodsResponseSchema = paymentMethodsRequestSchema;

/** Drawer positions are PostgreSQL bigint strings, preserving precision beyond JS safe integers. */
export const cashSeqSchema = minorAmountSchema;

const referenceSchema = text(60)
  .transform((v) => (v === "" ? null : v))
  .nullable();

/**
 * `POST /v1/invoices/:id/payments` uses `Idempotency-Key` in the header. The server supplies now;
 * accepting a date here would allow backdating a receipt into an already closed business day.
 */
export const createPaymentRequestSchema = z
  .object({
    method: paymentMethodSchema,
    amountMinor: positiveMinorAmountSchema,
    reference: referenceSchema.optional(),
  })
  .strict();
export type CreatePaymentRequest = z.infer<typeof createPaymentRequestSchema>;

/** A receipt belongs to one invoice; only cash receipts occupy a drawer sequence position. */
export const paymentSchema = z
  .object({
    id: idSchema,
    receiptNumber: z.string(),
    branchId: idSchema,
    invoiceId: idSchema,
    invoiceNumber: z.string(),
    patientId: idSchema,
    patientName: z.string(),
    method: paymentMethodSchema,
    amountMinor: positiveMinorAmountSchema,
    currency: currencyCodeSchema,
    currencyExponent: z.number().int(),
    reference: referenceSchema,
    receivedAt: z.string().datetime(),
    businessDate: dateSchema,
    cashSeq: cashSeqSchema.nullable(),
    receivedBy: idSchema,
  })
  .strict()
  .refine((v) => (v.method === "cash") === (v.cashSeq !== null), {
    path: ["cashSeq"],
    message: "validation.required",
  });
export type Payment = z.infer<typeof paymentSchema>;

/** The write returns the new settlement so the client need not calculate it from a receipt. */
export const paymentWriteResponseSchema = z
  .object({ payment: paymentSchema, settlement: invoiceSettlementSchema })
  .strict();

/** `POST /v1/invoices/:id/credit-applications` explicitly spends clinic-wide patient credit. */
export const createCreditApplicationRequestSchema = z
  .object({ amountMinor: positiveMinorAmountSchema })
  .strict();
export type CreateCreditApplicationRequest = z.infer<typeof createCreditApplicationRequestSchema>;

/** One application can consume several credits; allocation ids preserve their individual origins. */
export const creditAllocationSchema = z
  .object({
    id: idSchema,
    creditId: idSchema,
    amountMinor: positiveMinorAmountSchema,
    createdAt: z.string().datetime(),
  })
  .strict();

/** At least one allocation proves the explicit application moved credit onto the invoice. */
export const creditApplicationResponseSchema = z
  .object({
    allocations: z.array(creditAllocationSchema).min(1, "validation.required"),
    settlement: invoiceSettlementSchema,
    creditBalanceMinor: minorAmountSchema,
  })
  .strict();

/** `GET /v1/payments` filters by clinic-timezone business day, not a client's local timestamp. */
export const paymentListQuerySchema = z
  .object({
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    branchId: idSchema.optional(),
    method: paymentMethodSchema.optional(),
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    patientId: idSchema.optional(),
    invoiceId: idSchema.optional(),
    receiptNumber: z
      .string()
      .trim()
      .min(1, "validation.required")
      .max(40, "validation.tooLong")
      .optional(),
  })
  .strict();
export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>;

/** A cursor page avoids loading the clinic's entire receipt history. */
export const paymentListResponseSchema = z
  .object({
    items: z.array(paymentSchema),
    nextCursor: z.string().nullable(),
    total: z.number().int().nonnegative(),
  })
  .strict();

/** `GET /v1/payments/:id` returns the receipt independently of the invoice movement history. */
export const paymentResponseSchema = z.object({ payment: paymentSchema }).strict();
