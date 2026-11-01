import {
  reportExportRequestSchema,
  type ReportExportRequest,
  type ReportId,
} from "@eyadex/contracts/finance-reports";
import type { PermissionScope } from "@eyadex/contracts/permissions";

import { ApiError } from "../../../shared/errors.ts";
import type { BillingActor } from "./billing-actor.ts";
import { reportBranchIds, reportScope } from "./report-scope.ts";

const GROUP_DEFAULTS = {
  daily_takings: "day",
  period_summary: "month",
} as const satisfies Partial<Record<ReportId, "day" | "month">>;

/** طلب التصدير بعد التجميد: الفروع صريحة، ومفيش فلتر اختياري يقدر الـ worker يوسّعه. */
export interface FrozenExportAdmission {
  readonly scope: PermissionScope;
  readonly branchIds: readonly string[];
  readonly params: {
    readonly from: string;
    readonly to: string;
    readonly language: "ar" | "en";
    readonly branchIds: readonly string[];
    readonly groupBy?: "day" | "month";
  };
}

/**
 * بيقرأ طلب التصدير على حدود الـ use case. المدى الأطول من 1096 يوم شامل هو
 * `report_range_too_long`؛ أي شكل تاني غلط هو `validation` من غير القيم المرفوضة.
 *
 * @param input جسم الطلب زي ما وصل، قبل أي ثقة في نوعه
 * @returns الطلب بعد الـ schema، بالقيم الافتراضية المطبقة
 */
export function parseReportExportRequest(input: unknown): ReportExportRequest {
  const result = reportExportRequestSchema.safeParse(input);
  if (!result.success) {
    if (result.error.issues.some((issue) => issue.message === "validation.rangeTooLong")) {
      throw new ApiError("report_range_too_long");
    }
    throw new ApiError(
      "validation",
      result.error.issues.map((issue) => ({ path: issue.path.map(String), code: issue.code })),
    );
  }
  return result.data;
}

/**
 * سقف الطابور لازم يتحقن. مفيش افتراض، ومفيش قراءة من البيئة: رقم صحيح موجب وآمن بس.
 *
 * @param maxQueuedPerClinic الحد المحقون
 * @returns نفس الرقم بعد التحقق
 */
export function exportQueueLimit(maxQueuedPerClinic: number): number {
  if (!Number.isSafeInteger(maxQueuedPerClinic) || maxQueuedPerClinic < 1) {
    throw new TypeError("maxQueuedPerClinic must be a positive safe integer");
  }
  return maxQueuedPerClinic;
}

/**
 * قرار القبول تحت القفل: تصدير `running` لنفس العضو، أو طابور العيادة واصل للسقف، يرفض.
 * السقف مش افتراض هنا؛ اللي بينادي لازم يكون عدّاه على `exportQueueLimit`.
 *
 * @param input حالة العضو وعدد الصفوف `queued` والسقف المحقون
 * @returns `admit` أو `busy`
 */
export function decideExportAdmission(input: {
  readonly runningForMember: boolean;
  readonly queuedCount: number;
  readonly maxQueuedPerClinic: number;
}): "admit" | "busy" {
  if (input.runningForMember || input.queuedCount >= input.maxQueuedPerClinic) return "busy";
  return "admit";
}

/**
 * مفتاح قفل طابور التصدير. مش `finance:` عشان سعر العملة وإصدار أول فاتورة مايتسلسلوش مع التصدير.
 *
 * @param clinicId العيادة
 * @returns المفتاح اللي يتقفل بـ `hashtextextended`
 */
export function reportExportLockName(clinicId: string): string {
  return `finance-report-exports:${clinicId}`;
}

/**
 * بيجمّد نطاق التقرير من `reportScope` و`reportBranchIds` من غير ما ينسخ جدول المفاتيح.
 * الفلتر خارج النطاق ممنوع، والفروع المتوقفة داخل النطاق بتتسجل صريحة عشان الـ worker مايوسّعش.
 *
 * @param actor الفاعل بمفاتيحه وفروعه
 * @param request التقرير والمدى واللغة والفلتر بعد الـ schema
 * @param clinicBranchIds كل فروع العيادة، بما فيها المتوقفة، بترتيب القارئ
 * @returns النطاق الأعلى والـ params المجمّدة
 */
export function admitExportScope(
  actor: BillingActor,
  request: Pick<
    ReportExportRequest,
    "report" | "from" | "to" | "branchId" | "language" | "groupBy"
  >,
  clinicBranchIds: readonly string[],
): FrozenExportAdmission {
  const reach = reportScope(actor, request.report);
  if (reach === null) throw new ApiError("forbidden");
  const branchIds = reportBranchIds(reach, clinicBranchIds, request.branchId);
  if (branchIds === null) throw new ApiError("forbidden");
  const frozen = [...branchIds];
  const groupBy =
    request.report === "daily_takings" || request.report === "period_summary"
      ? (request.groupBy ?? GROUP_DEFAULTS[request.report])
      : undefined;
  return {
    scope: reach.scope,
    branchIds: frozen,
    params: {
      from: request.from,
      to: request.to,
      language: request.language,
      branchIds: frozen,
      ...(groupBy === undefined ? {} : { groupBy }),
    },
  };
}
