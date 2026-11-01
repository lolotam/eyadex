import { z } from "zod";
import { legacyNumber } from "./number-compat.ts";
import { legacyInteger } from "./integer-compat.ts";
import { utcDatetime } from "./datetime-compat.ts";

import { idSchema, languageSchema } from "./common.ts";
import {
  REPORT_EXPORT_RANGE_MAX_DAYS,
  reportFields,
  reportGroupBySchema,
  reportIdSchema,
  reportRangeWithin,
  type ReportId,
} from "./finance-reports-rows.ts";

/** F3-Q5 b: the export is a CSV or an XLSX file; the PDF waits for the F1 renderer (spec §7.1). */
export const reportExportFormatSchema = z.enum(["csv", "xlsx"]);
export type ReportExportFormat = z.infer<typeof reportExportFormatSchema>;

/** The status column of the export table (spec §7.3). */
export const reportExportStatusSchema = z.enum([
  "queued",
  "running",
  "done",
  "failed",
  "expired",
  "purged",
]);
export type ReportExportStatus = z.infer<typeof reportExportStatusSchema>;

/** The two reports that group their range by a day or a month (spec §4, R1 and R2). */
const GROUPED_REPORTS: readonly ReportId[] = ["daily_takings", "period_summary"];

/**
 * The export request: the report, its filters, the format and the language of the file's headers
 * (spec §7.1, §7.2). The range reaches three years, longer than a report on screen (F3-Q6 a), and
 * `groupBy` belongs to R1 and R2 only — without it the report's own grouping applies.
 */
export const reportExportRequestSchema = z
  .object({
    report: reportIdSchema,
    ...reportFields,
    groupBy: reportGroupBySchema.optional(),
    format: reportExportFormatSchema,
    language: languageSchema,
  })
  .strict()
  .superRefine((request, ctx) => {
    reportRangeWithin(REPORT_EXPORT_RANGE_MAX_DAYS)(request, ctx);
    if (request.groupBy === undefined) return;
    if (GROUPED_REPORTS.includes(request.report)) return;
    ctx.addIssue({ code: "custom", path: ["groupBy"], message: "validation.required" });
  });
export type ReportExportRequest = z.infer<typeof reportExportRequestSchema>;

/**
 * Persisted export filters. `branchIds` is required even when empty, and R1/R2 already store
 * `groupBy`. The shape adds no defaults and accepts no extra key.
 */
const frozenReportExportParamsSchema = z
  .object({
    from: reportFields.from,
    to: reportFields.to,
    language: languageSchema,
    branchIds: z.array(idSchema).readonly(),
    groupBy: reportGroupBySchema.optional(),
  })
  .strict()
  .readonly();
export type FrozenReportExportParams = z.infer<typeof frozenReportExportParamsSchema>;

/**
 * Reads stored export params. A missing, null, extra, or oversized value is null; the input is
 * not mutated and the refusal carries no raw params. `branchIds` is removed before the request
 * schema sees the other fields, so the request's optional `branchId` is never a stand-in.
 */
export function parseFrozenReportExportParams(
  report: ReportId,
  format: ReportExportFormat,
  input: unknown,
): FrozenReportExportParams | null {
  const frozen = frozenReportExportParamsSchema.safeParse(input);
  if (!frozen.success) return null;
  const { branchIds: _branchIds, ...fields } = frozen.data;
  const request = reportExportRequestSchema.safeParse({ ...fields, report, format });
  if (!request.success) return null;
  if (GROUPED_REPORTS.includes(report) && request.data.groupBy === undefined) return null;
  return frozen.data;
}

/**
 * The export row (spec §7.3). It carries no patient field: the patients of an `own` export live in the
 * table's own column, which the download clears when the file expires (EY-10.4).
 */
export const reportExportSchema = z
  .object({
    id: idSchema,
    report: reportIdSchema,
    format: reportExportFormatSchema,
    status: reportExportStatusSchema,
    createdAt: utcDatetime(),
    expiresAt: utcDatetime().nullable(),
    byteSize: legacyNumber().check(legacyInteger()).check(z.nonnegative()).nullable(),
    rowCount: legacyNumber().check(legacyInteger()).check(z.nonnegative()).nullable(),
  })
  .strict();
export type ReportExport = z.infer<typeof reportExportSchema>;

/** `POST /v1/finance-reports/exports` answers 202 with the queued export (spec §7.2). */
export const reportExportResponseSchema = z.object({ export: reportExportSchema }).strict();

/** The requester's own export list, newest first (spec §7.3). */
export const reportExportListResponseSchema = z
  .object({
    items: z.array(reportExportSchema),
    nextCursor: z.string().nullable(),
    total: legacyNumber().check(legacyInteger()).check(z.nonnegative()),
  })
  .strict();

/** One column of an exported file: the row field it reads and how it is written (spec §7.1). */
export const reportExportColumnSchema = z
  .object({
    key: z.string(),
    header: z.object({ ar: z.string(), en: z.string() }).strict(),
    kind: z.enum(["text", "money", "count", "date"]),
  })
  .strict();
export type ReportExportColumn = z.infer<typeof reportExportColumnSchema>;

/*
 * The headers of the exported columns, in the caller's language (spec §7.1). They are plain data, so
 * the mock and the exporter write the same header for the same column.
 */
const PERIOD_HEADER = { ar: "الفترة", en: "Period" };
const MONTH_HEADER = { ar: "الشهر", en: "Month" };
const BRANCH_HEADER = { ar: "الفرع", en: "Branch" };
const METHOD_HEADER = { ar: "طريقة الدفع", en: "Method" };
const COLLECTED_HEADER = { ar: "المحصّل", en: "Collected" };
const REFUNDED_HEADER = { ar: "المسترد", en: "Refunded" };
const NET_HEADER = { ar: "الصافي", en: "Net" };
const CURRENCY_HEADER = { ar: "العملة", en: "Currency" };
const INVOICED_HEADER = { ar: "المفوتر", en: "Invoiced" };
const DISCOUNTS_HEADER = { ar: "الخصومات", en: "Discounts" };
const TAX_HEADER = { ar: "الضريبة", en: "Tax" };
const CREDIT_APPLIED_HEADER = { ar: "رصيد مطبّق", en: "Credit applied" };
const VOIDED_HEADER = { ar: "الفواتير الملغاة", en: "Voided invoices" };
const SERVICE_HEADER = { ar: "الخدمة", en: "Service" };
const DOCTOR_HEADER = { ar: "الدكتور", en: "Doctor" };
const LINES_HEADER = { ar: "عدد البنود", en: "Lines" };
const QUANTITY_HEADER = { ar: "الكمية", en: "Quantity" };
const AMOUNT_HEADER = { ar: "المبلغ", en: "Amount" };
const INVOICE_NUMBER_HEADER = { ar: "رقم الفاتورة", en: "Invoice number" };
const DATE_HEADER = { ar: "التاريخ", en: "Date" };
const PATIENT_HEADER = { ar: "اسم المراجع", en: "Patient" };
const TOTAL_HEADER = { ar: "الإجمالي", en: "Total" };
const PAID_HEADER = { ar: "المدفوع", en: "Paid" };
const OUTSTANDING_HEADER = { ar: "المستحق", en: "Outstanding" };
const AGE_HEADER = { ar: "فئة العمر", en: "Age" };
const BALANCE_HEADER = { ar: "الرصيد", en: "Balance" };
const OLDEST_CREDIT_HEADER = { ar: "أقدم رصيد", en: "Oldest credit" };
const REFUND_NUMBER_HEADER = { ar: "رقم الاسترداد", en: "Refund number" };
const SOURCE_HEADER = { ar: "المصدر", en: "Source" };
const REFUNDED_BY_HEADER = { ar: "الاسترداد بواسطة", en: "Refunded by" };
const REASON_HEADER = { ar: "السبب", en: "Reason" };
const DISCOUNT_TYPE_HEADER = { ar: "نوع الخصم", en: "Discount type" };
const DISCOUNT_AMOUNT_HEADER = { ar: "قيمة الخصم", en: "Discount amount" };
const DISCOUNTED_BY_HEADER = { ar: "الخصم بواسطة", en: "Discounted by" };
const EXPECTED_HEADER = { ar: "المتوقع", en: "Expected" };
const COUNTED_HEADER = { ar: "المعدود", en: "Counted" };
const DIFFERENCE_HEADER = { ar: "الفرق", en: "Difference" };
const CLOSED_BY_HEADER = { ar: "أغلق الصندوق", en: "Closed by" };
const NOTE_HEADER = { ar: "فيه ملاحظة", en: "Note" };
const BILLED_HEADER = { ar: "المبلغ", en: "Billed" };

/**
 * The columns of every report, in order (spec §7.1): the headers follow the caller's language, the
 * amounts are written in major units with the currency's decimals, and every text cell is guarded
 * against a formula. The currency column reads the row's own currency, so every row carries it. A
 * column that names a staff member reads the row's display name, never the membership id (spec §4).
 */
export const REPORT_EXPORT_COLUMNS = {
  daily_takings: [
    { key: "period", header: PERIOD_HEADER, kind: "date" },
    { key: "branchName", header: BRANCH_HEADER, kind: "text" },
    { key: "method", header: METHOD_HEADER, kind: "text" },
    { key: "inMinor", header: COLLECTED_HEADER, kind: "money" },
    { key: "outMinor", header: REFUNDED_HEADER, kind: "money" },
    { key: "netMinor", header: NET_HEADER, kind: "money" },
    { key: "currency", header: CURRENCY_HEADER, kind: "text" },
  ],
  period_summary: [
    { key: "period", header: PERIOD_HEADER, kind: "date" },
    { key: "branchName", header: BRANCH_HEADER, kind: "text" },
    { key: "invoicedMinor", header: INVOICED_HEADER, kind: "money" },
    { key: "discountMinor", header: DISCOUNTS_HEADER, kind: "money" },
    { key: "taxMinor", header: TAX_HEADER, kind: "money" },
    { key: "collectedMinor", header: COLLECTED_HEADER, kind: "money" },
    { key: "refundedMinor", header: REFUNDED_HEADER, kind: "money" },
    { key: "creditAppliedMinor", header: CREDIT_APPLIED_HEADER, kind: "money" },
    { key: "voidCount", header: VOIDED_HEADER, kind: "count" },
    { key: "currency", header: CURRENCY_HEADER, kind: "text" },
  ],
  by_service: [
    { key: "name", header: SERVICE_HEADER, kind: "text" },
    { key: "lineCount", header: LINES_HEADER, kind: "count" },
    { key: "quantity", header: QUANTITY_HEADER, kind: "count" },
    { key: "amountMinor", header: AMOUNT_HEADER, kind: "money" },
    { key: "currency", header: CURRENCY_HEADER, kind: "text" },
  ],
  by_doctor: [
    { key: "name", header: DOCTOR_HEADER, kind: "text" },
    { key: "lineCount", header: LINES_HEADER, kind: "count" },
    { key: "quantity", header: QUANTITY_HEADER, kind: "count" },
    { key: "amountMinor", header: AMOUNT_HEADER, kind: "money" },
    { key: "currency", header: CURRENCY_HEADER, kind: "text" },
  ],
  outstanding: [
    { key: "invoiceNumber", header: INVOICE_NUMBER_HEADER, kind: "text" },
    { key: "branchName", header: BRANCH_HEADER, kind: "text" },
    { key: "businessDate", header: DATE_HEADER, kind: "date" },
    { key: "patientName", header: PATIENT_HEADER, kind: "text" },
    { key: "totalMinor", header: TOTAL_HEADER, kind: "money" },
    { key: "paidMinor", header: PAID_HEADER, kind: "money" },
    { key: "owedMinor", header: OUTSTANDING_HEADER, kind: "money" },
    { key: "ageBucket", header: AGE_HEADER, kind: "text" },
    { key: "currency", header: CURRENCY_HEADER, kind: "text" },
  ],
  patient_credit: [
    { key: "patientName", header: PATIENT_HEADER, kind: "text" },
    { key: "balanceMinor", header: BALANCE_HEADER, kind: "money" },
    { key: "oldestCreditDay", header: OLDEST_CREDIT_HEADER, kind: "date" },
    { key: "currency", header: CURRENCY_HEADER, kind: "text" },
  ],
  refunds: [
    { key: "refundNumber", header: REFUND_NUMBER_HEADER, kind: "text" },
    { key: "businessDate", header: DATE_HEADER, kind: "date" },
    { key: "branchName", header: BRANCH_HEADER, kind: "text" },
    { key: "patientName", header: PATIENT_HEADER, kind: "text" },
    { key: "method", header: METHOD_HEADER, kind: "text" },
    { key: "source", header: SOURCE_HEADER, kind: "text" },
    { key: "amountMinor", header: AMOUNT_HEADER, kind: "money" },
    { key: "refundedByName", header: REFUNDED_BY_HEADER, kind: "text" },
    { key: "reason", header: REASON_HEADER, kind: "text" },
    { key: "currency", header: CURRENCY_HEADER, kind: "text" },
  ],
  discounts: [
    { key: "invoiceNumber", header: INVOICE_NUMBER_HEADER, kind: "text" },
    { key: "businessDate", header: DATE_HEADER, kind: "date" },
    { key: "branchName", header: BRANCH_HEADER, kind: "text" },
    { key: "patientName", header: PATIENT_HEADER, kind: "text" },
    { key: "kind", header: DISCOUNT_TYPE_HEADER, kind: "text" },
    { key: "discountMinor", header: DISCOUNT_AMOUNT_HEADER, kind: "money" },
    { key: "discountedByName", header: DISCOUNTED_BY_HEADER, kind: "text" },
    { key: "reason", header: REASON_HEADER, kind: "text" },
    { key: "currency", header: CURRENCY_HEADER, kind: "text" },
  ],
  cash_closings: [
    { key: "businessDate", header: DATE_HEADER, kind: "date" },
    { key: "branchName", header: BRANCH_HEADER, kind: "text" },
    { key: "expectedMinor", header: EXPECTED_HEADER, kind: "money" },
    { key: "countedMinor", header: COUNTED_HEADER, kind: "money" },
    { key: "differenceMinor", header: DIFFERENCE_HEADER, kind: "money" },
    { key: "closedByName", header: CLOSED_BY_HEADER, kind: "text" },
    { key: "notePresent", header: NOTE_HEADER, kind: "text" },
    { key: "currency", header: CURRENCY_HEADER, kind: "text" },
  ],
  own_summary: [
    { key: "period", header: MONTH_HEADER, kind: "date" },
    { key: "billedMinor", header: BILLED_HEADER, kind: "money" },
    { key: "currency", header: CURRENCY_HEADER, kind: "text" },
  ],
} satisfies Record<ReportId, readonly ReportExportColumn[]>;
