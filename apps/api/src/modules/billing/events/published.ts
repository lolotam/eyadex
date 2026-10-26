import type { OutboxEvent } from "../../../shared/outbox.ts";

/** طلب تصدير اتسجل. الـ worker بياخد الـ id بس ويعيد فحص الصلاحية وقت التشغيل. */
export const FINANCE_REPORT_EXPORT_REQUESTED = "finance.report_export_requested";

/**
 * بيبني حدث طلب التصدير. الـ payload هو `exportId` وبس: مفيش مدى ولا فروع ولا أسماء.
 *
 * @param id id الحدث
 * @param clinicId العيادة، ولازم تساوي سياق الـ transaction
 * @param createdAt وقت الطلب من الساعة المحقونة
 * @param exportId id صف التصدير
 * @returns صف الـ outbox
 */
export function publishReportExportRequested(
  id: string,
  clinicId: string,
  createdAt: Date,
  exportId: string,
): OutboxEvent {
  return {
    id,
    clinicId,
    type: FINANCE_REPORT_EXPORT_REQUESTED,
    payload: { exportId },
    createdAt,
  };
}
