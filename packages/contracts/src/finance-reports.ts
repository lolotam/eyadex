import { z } from "zod";
import { legacyNumber } from "./number-compat.ts";
import { legacyInteger } from "./integer-compat.ts";

import { currencyCodeSchema, minorAmountSchema, signedMinorAmountSchema } from "./money.ts";
import {
  REPORT_RANGE_MAX_DAYS,
  cursorFields,
  reportByDoctorRowSchema,
  reportByServiceRowSchema,
  reportCashClosingRowSchema,
  reportDailyTakingsRowSchema,
  reportDiscountRowSchema,
  reportFields,
  reportGroupBySchema,
  reportOutstandingRowSchema,
  reportOutstandingSummaryRowSchema,
  reportOwnSummaryRowSchema,
  reportPatientCreditRowSchema,
  reportPeriodSummaryRowSchema,
  reportRangeWithin,
  reportRefundRowSchema,
} from "./finance-reports-rows.ts";

export * from "./finance-reports-rows.ts";
export * from "./finance-reports-export.ts";
export * from "./finance-reports-export-list.ts";
export * from "./finance-report-export-audit.ts";

/** R1: the daily takings of a range, grouped by a day or by a month (spec §4, R1). */
export const reportDailyTakingsQuerySchema = z
  .object({
    ...reportFields,
    groupBy: reportGroupBySchema.default("day"),
  })
  .strict()
  .superRefine(reportRangeWithin(REPORT_RANGE_MAX_DAYS));

/** R2: the period summary, grouped by a month or by a day (spec §4, R2). */
export const reportPeriodSummaryQuerySchema = z
  .object({
    ...reportFields,
    groupBy: reportGroupBySchema.default("month"),
  })
  .strict()
  .superRefine(reportRangeWithin(REPORT_RANGE_MAX_DAYS));

/** R3: the revenue by service over a range (spec §4, R3). */
export const reportByServiceQuerySchema = z
  .object({ ...reportFields })
  .strict()
  .superRefine(reportRangeWithin(REPORT_RANGE_MAX_DAYS));

/** R4: the revenue by doctor over a range (spec §4, R4). */
export const reportByDoctorQuerySchema = z
  .object({ ...reportFields })
  .strict()
  .superRefine(reportRangeWithin(REPORT_RANGE_MAX_DAYS));

/** R5: the outstanding invoices of a range, page by page (spec §4, R5). */
export const reportOutstandingQuerySchema = z
  .object({ ...reportFields, ...cursorFields })
  .strict()
  .superRefine(reportRangeWithin(REPORT_RANGE_MAX_DAYS));

/** R6: the patients with credit over a range, page by page (spec §4, R6). */
export const reportPatientCreditQuerySchema = z
  .object({ ...reportFields, ...cursorFields })
  .strict()
  .superRefine(reportRangeWithin(REPORT_RANGE_MAX_DAYS));

/** R7: the refunds of a range, page by page (spec §4, R7). */
export const reportRefundQuerySchema = z
  .object({ ...reportFields, ...cursorFields })
  .strict()
  .superRefine(reportRangeWithin(REPORT_RANGE_MAX_DAYS));

/** R8: the discounts of a range, page by page (spec §4, R8). */
export const reportDiscountQuerySchema = z
  .object({ ...reportFields, ...cursorFields })
  .strict()
  .superRefine(reportRangeWithin(REPORT_RANGE_MAX_DAYS));

/** R9: the cash closings of a range (spec §4, R9). */
export const reportCashClosingQuerySchema = z
  .object({ ...reportFields })
  .strict()
  .superRefine(reportRangeWithin(REPORT_RANGE_MAX_DAYS));

/** R10: the doctor's own billed amount per month (spec §4, R10). */
export const reportOwnSummaryQuerySchema = z
  .object({ ...reportFields })
  .strict()
  .superRefine(reportRangeWithin(REPORT_RANGE_MAX_DAYS));

/** R1: the rows of the range and their totals, in the clinic's currency (spec §4, R1). */
export const reportDailyTakingsResponseSchema = z
  .object({
    rows: z.array(reportDailyTakingsRowSchema),
    totals: z
      .object({
        inMinor: minorAmountSchema,
        outMinor: minorAmountSchema,
        netMinor: signedMinorAmountSchema,
      })
      .strict(),
    currency: currencyCodeSchema,
    currencyExponent: legacyNumber().check(legacyInteger()),
  })
  .strict();

/** R2: the rows of the range and their totals (spec §4, R2). */
export const reportPeriodSummaryResponseSchema = z
  .object({
    rows: z.array(reportPeriodSummaryRowSchema),
    totals: z
      .object({
        invoicedMinor: minorAmountSchema,
        discountMinor: minorAmountSchema,
        taxMinor: minorAmountSchema,
        collectedMinor: minorAmountSchema,
        refundedMinor: minorAmountSchema,
        creditAppliedMinor: minorAmountSchema,
        voidCount: legacyNumber().check(legacyInteger()).check(z.nonnegative()),
      })
      .strict(),
    currency: currencyCodeSchema,
    currencyExponent: legacyNumber().check(legacyInteger()),
  })
  .strict();

/**
 * R3: the rows of the range and their totals. The tax line is one of the rows, so the billed amount
 * and the tax add up to the invoices' total (F3-Q3 a).
 */
export const reportByServiceResponseSchema = z
  .object({
    rows: z.array(reportByServiceRowSchema),
    totals: z
      .object({
        lineCount: legacyNumber().check(legacyInteger()).check(z.nonnegative()),
        quantity: legacyNumber().check(legacyInteger()).check(z.nonnegative()),
        billedMinor: minorAmountSchema,
        taxMinor: minorAmountSchema,
        totalMinor: minorAmountSchema,
      })
      .strict(),
    currency: currencyCodeSchema,
    currencyExponent: legacyNumber().check(legacyInteger()),
  })
  .strict();

/** R4: the rows of the range and their totals, like R3 (spec §4, R4). */
export const reportByDoctorResponseSchema = z
  .object({
    rows: z.array(reportByDoctorRowSchema),
    totals: z
      .object({
        lineCount: legacyNumber().check(legacyInteger()).check(z.nonnegative()),
        quantity: legacyNumber().check(legacyInteger()).check(z.nonnegative()),
        billedMinor: minorAmountSchema,
        taxMinor: minorAmountSchema,
        totalMinor: minorAmountSchema,
      })
      .strict(),
    currency: currencyCodeSchema,
    currencyExponent: legacyNumber().check(legacyInteger()),
  })
  .strict();

/** R5: a page of the invoices that still owe money, with the summary per bucket and branch. */
export const reportOutstandingResponseSchema = z
  .object({
    items: z.array(reportOutstandingRowSchema),
    nextCursor: z.string().nullable(),
    total: legacyNumber().check(legacyInteger()).check(z.nonnegative()),
    summary: z.array(reportOutstandingSummaryRowSchema),
    currency: currencyCodeSchema,
    currencyExponent: legacyNumber().check(legacyInteger()),
  })
  .strict();

/** R6: a page of the patients with credit. */
export const reportPatientCreditResponseSchema = z
  .object({
    items: z.array(reportPatientCreditRowSchema),
    nextCursor: z.string().nullable(),
    total: legacyNumber().check(legacyInteger()).check(z.nonnegative()),
    currency: currencyCodeSchema,
    currencyExponent: legacyNumber().check(legacyInteger()),
  })
  .strict();

/** R7: a page of the refunds. */
export const reportRefundResponseSchema = z
  .object({
    items: z.array(reportRefundRowSchema),
    nextCursor: z.string().nullable(),
    total: legacyNumber().check(legacyInteger()).check(z.nonnegative()),
    currency: currencyCodeSchema,
    currencyExponent: legacyNumber().check(legacyInteger()),
  })
  .strict();

/** R8: a page of the discounts. */
export const reportDiscountResponseSchema = z
  .object({
    items: z.array(reportDiscountRowSchema),
    nextCursor: z.string().nullable(),
    total: legacyNumber().check(legacyInteger()).check(z.nonnegative()),
    currency: currencyCodeSchema,
    currencyExponent: legacyNumber().check(legacyInteger()),
  })
  .strict();

/** R9: the rows of the range and the totals of the differences (spec §4, R9). */
export const reportCashClosingResponseSchema = z
  .object({
    rows: z.array(reportCashClosingRowSchema),
    totals: z
      .object({
        expectedMinor: signedMinorAmountSchema,
        countedMinor: minorAmountSchema,
        differenceMinor: signedMinorAmountSchema,
      })
      .strict(),
    currency: currencyCodeSchema,
    currencyExponent: legacyNumber().check(legacyInteger()),
  })
  .strict();

/** R10: the months of the range and the doctor's own billed amount (spec §4, R10). */
export const reportOwnSummaryResponseSchema = z
  .object({
    rows: z.array(reportOwnSummaryRowSchema),
    totals: z.object({ billedMinor: minorAmountSchema }).strict(),
    currency: currencyCodeSchema,
    currencyExponent: legacyNumber().check(legacyInteger()),
  })
  .strict();
