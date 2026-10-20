import { z } from "zod";
import { idSchema } from "./common.ts";
import { dateSchema } from "./finance-list.ts";
import { cashSeqSchema, paymentMethodSchema } from "./finance-payments.ts";
import { text } from "./finance-text.ts";
import {
  currencyCodeSchema,
  minorAmountSchema,
  positiveMinorAmountSchema,
  signedMinorAmountSchema,
} from "./money.ts";

/** Per-method inflows and outflows stay separate so refunds do not hide the collected amount. */
export const methodTotalSchema = z
  .object({ method: paymentMethodSchema, inMinor: minorAmountSchema, outMinor: minorAmountSchema })
  .strict();

/** Closing details identify cash receipts and refunds without exposing patient identity. */
export const cashMovementSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("payment"),
      paymentId: idSchema,
      receiptNumber: z.string(),
      cashSeq: cashSeqSchema,
      amountMinor: positiveMinorAmountSchema,
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("refund"),
      refundId: idSchema,
      refundNumber: z.string(),
      cashSeq: cashSeqSchema,
      amountMinor: positiveMinorAmountSchema,
      at: z.string().datetime(),
    })
    .strict(),
]);
export type CashMovement = z.infer<typeof cashMovementSchema>;

/** `GET /v1/cash-closings/preview` targets one branch's drawer; it stores nothing. */
export const cashClosingPreviewQuerySchema = z.object({ branchId: idSchema }).strict();

/** The preview pins the drawer's sequence so a later write can detect intervening cash movements. */
export const cashClosingPreviewResponseSchema = z
  .object({
    branchId: idSchema,
    businessDate: dateSchema,
    previousClosingId: idSchema.nullable(),
    fromCashSeq: cashSeqSchema,
    throughCashSeq: cashSeqSchema,
    cashInMinor: minorAmountSchema,
    cashOutMinor: minorAmountSchema,
    expectedMinor: signedMinorAmountSchema,
    methodTotals: z.array(methodTotalSchema),
    movements: z.array(cashMovementSchema),
    currency: currencyCodeSchema,
    currencyExponent: z.number().int(),
  })
  .strict();
export type CashClosingPreview = z.infer<typeof cashClosingPreviewResponseSchema>;

const noteSchema = text(300)
  .transform((v) => (v === "" ? null : v))
  .nullable();

/**
 * `POST /v1/cash-closings` repeats the preview's position. The use case requires a note when the
 * count differs from its expected amount (`closing_note_required`); the request cannot know it.
 */
export const createCashClosingRequestSchema = z
  .object({
    branchId: idSchema,
    previousClosingId: idSchema.nullable(),
    throughCashSeq: cashSeqSchema,
    countedMinor: minorAmountSchema,
    note: noteSchema.optional(),
  })
  .strict();
export type CreateCashClosingRequest = z.infer<typeof createCashClosingRequestSchema>;

/** Saved closings preserve the counted result and signed shortage or surplus for that branch day. */
export const cashClosingSchema = z
  .object({
    id: idSchema,
    branchId: idSchema,
    businessDate: dateSchema,
    previousClosingId: idSchema.nullable(),
    fromCashSeq: cashSeqSchema,
    toCashSeq: cashSeqSchema,
    expectedMinor: signedMinorAmountSchema,
    countedMinor: minorAmountSchema,
    differenceMinor: signedMinorAmountSchema,
    methodTotals: z.array(methodTotalSchema),
    note: noteSchema,
    currency: currencyCodeSchema,
    currencyExponent: z.number().int(),
    closedBy: idSchema,
    closedAt: z.string().datetime(),
  })
  .strict();
export type CashClosing = z.infer<typeof cashClosingSchema>;

/** Only detail carries the period's cash movements, keeping list pages compact. */
export const cashClosingDetailSchema = cashClosingSchema
  .extend({ movements: z.array(cashMovementSchema) })
  .strict();
export type CashClosingDetail = z.infer<typeof cashClosingDetailSchema>;

/** Both `POST` and `GET /v1/cash-closings/:id` return the saved period and its cash movements. */
export const cashClosingResponseSchema = z
  .object({ cashClosing: cashClosingDetailSchema })
  .strict();

/** Closing dates are branch business days; cursor pagination follows the F1 invoice list. */
export const cashClosingListQuerySchema = z
  .object({
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    branchId: idSchema.optional(),
    from: dateSchema.optional(),
    to: dateSchema.optional(),
  })
  .strict();
export type CashClosingListQuery = z.infer<typeof cashClosingListQuerySchema>;

/** History lists saved closings without patient data or the full movement period. */
export const cashClosingListResponseSchema = z
  .object({
    items: z.array(cashClosingSchema),
    nextCursor: z.string().nullable(),
    total: z.number().int().nonnegative(),
  })
  .strict();
