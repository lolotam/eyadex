import { z } from "zod";

import { idSchema } from "./common.ts";
import { dateSchema } from "./finance-list.ts";
import { paymentMethodSchema } from "./finance-payments.ts";
import { text } from "./finance-text.ts";
import {
  cashMinorAmountSchema,
  currencyCodeSchema,
  minorAmountSchema,
  signedCashMinorAmountSchema,
  signedMinorAmountSchema,
} from "./money.ts";

/**
 * The ten reports of F3 (spec §4). The export table stores one of them in its `report` column
 * (spec §7.3), so the export module reads the ids from here.
 */
export const REPORT_IDS = [
  "daily_takings",
  "period_summary",
  "by_service",
  "by_doctor",
  "outstanding",
  "patient_credit",
  "refunds",
  "discounts",
  "cash_closings",
  "own_summary",
] as const;
export const reportIdSchema = z.enum(REPORT_IDS);
export type ReportId = z.infer<typeof reportIdSchema>;

/** R1 and R2 group their range by a clinic day or a clinic month (spec §4, R1 and R2). */
export const reportGroupBySchema = z.enum(["day", "month"]);
export type ReportGroupBy = z.infer<typeof reportGroupBySchema>;

/** F3-Q6 a: a report on screen covers at most 366 days; an export covers at most three years. */
export const REPORT_RANGE_MAX_DAYS = 366;
/** Three calendar years inclusive reach 1096 days (a leap year inside the span), so that is the bound. */
export const REPORT_EXPORT_RANGE_MAX_DAYS = 1096;

/** A real calendar month (`2026-10`): the twelve months only, so `2026-00` and `2026-13` are refused. */
const isCalendarMonth = (value: string): boolean => {
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
};

/** A real calendar day (`2026-10-23`) or a real calendar month (`2026-10`). */
const isRealPeriod = (value: string): boolean =>
  isCalendarMonth(value) && (value.length === 7 || dateSchema.safeParse(value).success);

/**
 * A report period is a clinic business day (`2026-10-23`) or a clinic month (`2026-10`). Both are
 * real calendar values: `2026-13-01`, `2026-02-30` and `2026-00` are refused, and a leap day is a
 * real day (`2028-02-29`).
 */
export const reportPeriodSchema = z
  .string()
  .regex(/^\d{4}-\d{2}(-\d{2})?$/, "validation.date")
  .refine(isRealPeriod, "validation.date");

/** The days a range covers, both ends included, or null when the two are not days. */
const rangeDays = (from: string, to: string): number | null => {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.round((end - start) / 86_400_000) + 1;
};

/**
 * The range rule every report shares (spec §4, §6): the days are clinic business days, the range is
 * inclusive, it may not run backwards, and it may not be longer than the caller asked for. A range that
 * is too long is refused with the `validation.rangeTooLong` key; the API maps it to its
 * `report_range_too_long` error code (F3-Q6 a).
 */
export const reportRangeWithin =
  (maxDays: number) =>
  (range: { from: string; to: string }, ctx: z.RefinementCtx): void => {
    const days = rangeDays(range.from, range.to);
    if (days === null) return;
    if (days < 1) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "validation.dateOrder" });
      return;
    }
    if (days > maxDays) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "validation.rangeTooLong" });
    }
  };

/** The filters every report takes: the clinic business-day range and an optional branch (spec §4). */
export const reportFields = {
  from: dateSchema,
  to: dateSchema,
  branchId: idSchema.optional(),
};

/** The page fields of the list reports (R5–R8), as the finance lists have them (spec §7.2). */
export const cursorFields = {
  cursor: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
};

/** R1: the takings of one clinic business day, one branch and one payment method (spec §4, R1). */
export const reportDailyTakingsRowSchema = z
  .object({
    period: reportPeriodSchema,
    branchId: idSchema,
    branchName: z.string(),
    method: paymentMethodSchema,
    inMinor: minorAmountSchema,
    outMinor: minorAmountSchema,
    /** Refunds can exceed the day's receipts, so the net is signed (the F2 difference rule). */
    netMinor: signedMinorAmountSchema,
    currency: currencyCodeSchema,
  })
  .strict();

/** R2: one month (or day) of one branch, invoiced, collected and refunded (spec §4, R2). */
export const reportPeriodSummaryRowSchema = z
  .object({
    period: reportPeriodSchema,
    branchId: idSchema,
    branchName: z.string(),
    invoicedMinor: minorAmountSchema,
    discountMinor: minorAmountSchema,
    taxMinor: minorAmountSchema,
    collectedMinor: minorAmountSchema,
    refundedMinor: minorAmountSchema,
    /** Credit applied to an invoice is information, never collected money (R1-17). */
    creditAppliedMinor: minorAmountSchema,
    voidCount: z.number().int().nonnegative(),
    currency: currencyCodeSchema,
  })
  .strict();

/**
 * R3: the billed amount of one service. The free lines and the report-level tax line are rows of the
 * same table, so the rows and the tax line add up to the invoices' total (F3-Q3 a).
 */
export const reportByServiceRowSchema = z
  .object({
    kind: z.enum(["service", "free", "tax"]),
    serviceId: idSchema.nullable(),
    name: z.string(),
    lineCount: z.number().int().nonnegative(),
    quantity: z.number().int().nonnegative(),
    /** The billed amount of the rows, net of both discounts; the tax row carries the tax itself. */
    amountMinor: minorAmountSchema,
    currency: currencyCodeSchema,
  })
  .strict();

/** R4: the same shape as R3, grouped by the line's provider; lines with none are their own row. */
export const reportByDoctorRowSchema = z
  .object({
    kind: z.enum(["doctor", "none", "tax"]),
    providerId: idSchema.nullable(),
    name: z.string(),
    lineCount: z.number().int().nonnegative(),
    quantity: z.number().int().nonnegative(),
    amountMinor: minorAmountSchema,
    currency: currencyCodeSchema,
  })
  .strict();

/** The aging buckets of the outstanding balances (F3-Q2 a). */
export const reportAgeBucketSchema = z.enum(["0_30", "31_60", "61_90", "over_90"]);
export type ReportAgeBucket = z.infer<typeof reportAgeBucketSchema>;

/** R5: one issued invoice that still owes money (spec §4, R5). */
export const reportOutstandingRowSchema = z
  .object({
    invoiceId: idSchema,
    invoiceNumber: z.string(),
    branchId: idSchema,
    branchName: z.string(),
    businessDate: dateSchema,
    patientId: idSchema,
    patientName: z.string(),
    totalMinor: minorAmountSchema,
    paidMinor: minorAmountSchema,
    owedMinor: minorAmountSchema,
    ageBucket: reportAgeBucketSchema,
    currency: currencyCodeSchema,
  })
  .strict();

/** R5 also summarises what is owed per bucket and branch (spec §4, R5). */
export const reportOutstandingSummaryRowSchema = z
  .object({
    ageBucket: reportAgeBucketSchema,
    branchId: idSchema,
    invoiceCount: z.number().int().nonnegative(),
    owedMinor: minorAmountSchema,
  })
  .strict();

/** R6: one patient whose credit balance is above zero (spec §4, R6; the scope is the clinic, F2-Q7). */
export const reportPatientCreditRowSchema = z
  .object({
    patientId: idSchema,
    patientName: z.string(),
    balanceMinor: minorAmountSchema,
    oldestCreditDay: dateSchema,
    currency: currencyCodeSchema,
  })
  .strict();

/** A refund comes out of a receipt or out of the patient's credit (spec §2). */
export const reportRefundSourceSchema = z.enum(["payment", "credit"]);

/** R7: one refund (spec §4, R7). The reason is exported too (F3-Q8 b). */
export const reportRefundRowSchema = z
  .object({
    refundId: idSchema,
    refundNumber: z.string(),
    branchId: idSchema,
    branchName: z.string(),
    businessDate: dateSchema,
    patientId: idSchema,
    patientName: z.string(),
    method: paymentMethodSchema,
    source: reportRefundSourceSchema,
    amountMinor: minorAmountSchema,
    refundedBy: idSchema,
    /** The staff member who refunded, by name; null when the membership is gone (spec §4). */
    refundedByName: z.string().nullable(),
    reason: text(300),
    currency: currencyCodeSchema,
  })
  .strict();

/** A discount sits on a line or on the invoice itself (spec §4, R8). */
export const reportDiscountKindSchema = z.enum(["line", "invoice"]);

/** R8: one discount of one issued invoice (spec §4, R8). */
export const reportDiscountRowSchema = z
  .object({
    invoiceId: idSchema,
    invoiceNumber: z.string(),
    branchId: idSchema,
    branchName: z.string(),
    businessDate: dateSchema,
    patientId: idSchema,
    patientName: z.string(),
    kind: reportDiscountKindSchema,
    discountMinor: minorAmountSchema,
    /** Who set the discount, stored on the row; null for a discount set before the column existed (EY-10.2). */
    discountedBy: idSchema.nullable(),
    /** The name of that staff member, resolved the way the audit screen resolves one (spec §4). */
    discountedByName: z.string().nullable(),
    reason: text(300),
    currency: currencyCodeSchema,
  })
  .strict();

/** R9: one saved cash closing (spec §4, R9). It never reads the drawer's method totals (R3-8). */
export const reportCashClosingRowSchema = z
  .object({
    closingId: idSchema,
    branchId: idSchema,
    branchName: z.string(),
    businessDate: dateSchema,
    expectedMinor: signedCashMinorAmountSchema,
    countedMinor: cashMinorAmountSchema,
    /** A shortage is negative, so the difference is signed (the F2 closing rule). */
    differenceMinor: signedMinorAmountSchema,
    closedBy: idSchema,
    /** The staff member who closed the drawer, by name; null when the membership is gone (spec §4). */
    closedByName: z.string().nullable(),
    notePresent: z.boolean(),
    currency: currencyCodeSchema,
  })
  .strict();

/** R10 groups the doctor's own lines by a clinic month (spec §4, R10). The month must be a real one. */
export const reportMonthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "validation.date")
  .refine(isCalendarMonth, "validation.date");

/** R10: the doctor's own billed amount per month, with no paid or owed columns (EY-9.16 a). */
export const reportOwnSummaryRowSchema = z
  .object({
    period: reportMonthSchema,
    billedMinor: minorAmountSchema,
    currency: currencyCodeSchema,
  })
  .strict();
