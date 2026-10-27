import { reportExportSchema } from "@eyadex/contracts/finance-reports";

const ADMINISTRATIVE = new Set([
  "daily_takings",
  "period_summary",
  "by_service",
  "by_doctor",
  "cash_closings",
  "own_summary",
]);

/** تفاصيل النشر: التقرير والمدى والفروع والعدد. مفيش اسم ولا سبب. */
export interface ExportAuditDetails {
  readonly report: string;
  readonly from: string;
  readonly to: string;
  readonly branchIds: readonly string[];
  readonly rowCount: number;
}

/**
 * تصنيف صف `finance_report.exported`. المجهول patient access زي قيد 0068.
 *
 * @param report مفتاح التقرير على الصف
 * @returns `patient_access` لـ R5–R8 وأي مفتاح خارج قائمة الإداري
 */
export function auditCategory(report: string): "patient_access" | "administrative" {
  return ADMINISTRATIVE.has(report) ? "administrative" : "patient_access";
}

/**
 * يبني تفاصيل التدقيق من الـ params المجمّدة. أي حقل تاني، بما فيه الاسم والسبب، يتساب.
 *
 * @param input التقرير وعدد الصفوف و`params` كما هو مخزّن
 * @returns التفاصيل، أو `null` لو المدى أو الفروع ناقصة
 */
export function exportAuditDetails(input: {
  readonly report: string;
  readonly rowCount: number;
  readonly params: unknown;
}): ExportAuditDetails | null {
  if (typeof input.params !== "object" || input.params === null || Array.isArray(input.params))
    return null;
  const record = input.params as Record<string, unknown>;
  const { from, to, branchIds } = record;
  if (typeof from !== "string" || typeof to !== "string" || !Array.isArray(branchIds)) return null;
  const ids: string[] = [];
  for (const branchId of branchIds) {
    const parsed = reportExportSchema.shape.id.safeParse(branchId);
    if (!parsed.success) return null;
    ids.push(parsed.data.toLowerCase());
  }
  return { report: input.report, from, to, branchIds: ids, rowCount: input.rowCount };
}
