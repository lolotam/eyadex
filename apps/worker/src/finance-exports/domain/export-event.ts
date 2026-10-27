import { reportExportSchema } from "@eyadex/contracts/finance-reports";
import { z } from "zod";

/** نوع حدث طلب التصدير. الـ payload فيه `exportId` بس. */
export const FINANCE_REPORT_EXPORT_REQUESTED = "finance.report_export_requested";

const payloadSchema = z.object({ exportId: reportExportSchema.shape.id }).strict();

/** الحدث بعد التحقق: العيادة من صف الـ outbox، والتصدير من الـ payload. */
export interface ExportRequested {
  readonly clinicId: string;
  readonly exportId: string;
}

/**
 * يتحقق من النوع وسياق العيادة و`{ exportId }` بعقد المعرّف العام، مش قاعدة uuid محلية.
 *
 * @param event النوع والعيادة والـ payload كما وصلوا من الـ dispatcher
 * @returns الحدث، أو `null` لو بايظ (فشل فوري من غير كتابة)
 */
export function parseExportRequested(event: {
  readonly type: string;
  readonly clinicId: string | null;
  readonly payload: unknown;
}): ExportRequested | null {
  if (event.type !== FINANCE_REPORT_EXPORT_REQUESTED || event.clinicId === null) return null;
  const clinicId = reportExportSchema.shape.id.safeParse(event.clinicId);
  const payload = payloadSchema.safeParse(event.payload);
  if (!clinicId.success || !payload.success) return null;
  return { clinicId: clinicId.data, exportId: payload.data.exportId };
}
