import { z } from "zod";
import { legacyNumber, legacyCoercedNumber } from "./number-compat.ts";
import { legacyInteger } from "./integer-compat.ts";
import { utcDatetime } from "./datetime-compat.ts";
import { idSchema } from "./common.ts";
import { dateSchema } from "./finance-list.ts";
import { cashSeqSchema, paymentMethodSchema } from "./finance-payments.ts";
import { text } from "./finance-text.ts";
import {
  cashMinorAmountSchema,
  currencyCodeSchema,
  minorAmountSchema,
  positiveMinorAmountSchema,
  readMinor,
  signedCashMinorAmountSchema,
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
      at: utcDatetime(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("refund"),
      refundId: idSchema,
      refundNumber: z.string(),
      cashSeq: cashSeqSchema,
      amountMinor: positiveMinorAmountSchema,
      at: utcDatetime(),
    })
    .strict(),
]);
export type CashMovement = z.infer<typeof cashMovementSchema>;

/** `GET /v1/cash-closings/preview` targets one branch's drawer; it stores nothing. */
export const cashClosingPreviewQuerySchema = z.object({ branchId: idSchema }).strict();

/** The fields the preview rule reads, so it sees only the amounts it compares. */
type PreviewAmountsShape = {
  cashInMinor: string;
  cashOutMinor: string;
  expectedMinor: string;
};

/**
 * The preview's expected amount is the inflows minus the outflows. A wrong sign would show a shortage as
 * a surplus, so a preview that does not add up is refused at the expected amount.
 */
const expectedMatchesFlows = (preview: PreviewAmountsShape, ctx: z.RefinementCtx): void => {
  const cashIn = readMinor(preview.cashInMinor);
  const cashOut = readMinor(preview.cashOutMinor);
  const expected = readMinor(preview.expectedMinor);
  if (cashIn === null || cashOut === null || expected === null) return;
  if (expected === cashIn - cashOut) return;
  ctx.addIssue({ code: "custom", path: ["expectedMinor"], message: "validation.amount" });
};

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
    expectedMinor: signedCashMinorAmountSchema,
    methodTotals: z.array(methodTotalSchema),
    movements: z.array(cashMovementSchema),
    currency: currencyCodeSchema,
    currencyExponent: legacyNumber().check(legacyInteger()),
  })
  .strict()
  .superRefine(expectedMatchesFlows);
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
    countedMinor: cashMinorAmountSchema,
    note: noteSchema.optional(),
  })
  .strict();
export type CreateCashClosingRequest = z.infer<typeof createCashClosingRequestSchema>;

/** The fields the closing rule reads, so it sees only the amounts it compares. */
type ClosingAmountsShape = {
  expectedMinor: string;
  countedMinor: string;
  differenceMinor: string;
};

/**
 * The saved difference is the counted amount minus the expected one. A wrong sign would show a shortage
 * as a surplus, so a closing that does not add up is refused at the difference.
 */
const differenceMatchesCount = (closing: ClosingAmountsShape, ctx: z.RefinementCtx): void => {
  const expected = readMinor(closing.expectedMinor);
  const counted = readMinor(closing.countedMinor);
  const difference = readMinor(closing.differenceMinor);
  if (expected === null || counted === null || difference === null) return;
  if (difference === counted - expected) return;
  ctx.addIssue({ code: "custom", path: ["differenceMinor"], message: "validation.amount" });
};

/** Saved closings preserve the counted result and signed shortage or surplus for that branch day. */
export const cashClosingObjectSchema = z
  .object({
    id: idSchema,
    branchId: idSchema,
    businessDate: dateSchema,
    previousClosingId: idSchema.nullable(),
    fromCashSeq: cashSeqSchema,
    toCashSeq: cashSeqSchema,
    expectedMinor: signedCashMinorAmountSchema,
    countedMinor: cashMinorAmountSchema,
    differenceMinor: signedMinorAmountSchema,
    methodTotals: z.array(methodTotalSchema),
    note: noteSchema,
    currency: currencyCodeSchema,
    currencyExponent: legacyNumber().check(legacyInteger()),
    closedBy: idSchema,
    closedAt: utcDatetime(),
  })
  .strict();

/** The difference must add up, so no reader sees a shortage recorded as a surplus. */
export const cashClosingSchema = cashClosingObjectSchema.superRefine(differenceMatchesCount);
export type CashClosing = z.infer<typeof cashClosingSchema>;

/** Only detail carries the period's cash movements, keeping list pages compact. */
export const cashClosingDetailSchema = cashClosingObjectSchema
  .extend({ movements: z.array(cashMovementSchema) })
  .strict()
  .superRefine(differenceMatchesCount);
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
    limit: legacyCoercedNumber()
      .check(legacyInteger())
      .check(z.gte(1))
      .check(z.lte(100))
      .default(50),
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
    total: legacyNumber().check(legacyInteger()).check(z.nonnegative()),
  })
  .strict();
