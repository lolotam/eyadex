import type { ServiceStatus } from "@eyadex/contracts/services";
import { scrubAuditText } from "@eyadex/observability";

/** خدمة عيادة زي ما بتتخزن (D-12). */
export interface ServiceRecord {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly durationMinutes: number;
  readonly status: ServiceStatus;
}

/** اللي المستخدم بيكتبه في الخدمة. */
export type ServiceFields = Pick<ServiceRecord, "nameAr" | "nameEn" | "durationMinutes">;

/**
 * هل التعديل ما بيغيّرش حاجة؟ نفس الحقول = نفس الرد من غير صف سجل.
 *
 * @param before الخدمة قبل التعديل
 * @param input الحقول المطلوبة
 * @returns `true` لو الحقول التلاتة زي ما هي
 */
export function isServiceUnchanged(before: ServiceRecord, input: ServiceFields): boolean {
  return (
    before.nameAr === input.nameAr &&
    before.nameEn === input.nameEn &&
    before.durationMinutes === input.durationMinutes
  );
}

/**
 * لقطة السجل: الحقول المسموحة بس، والأسماء بعد التنضيف (رقم مكتوب في اسم ما يوصلش للسجل).
 *
 * @param service الخدمة
 * @returns اللقطة
 */
export function serviceAuditSnapshot(service: ServiceRecord) {
  return {
    nameAr: scrubAuditText(service.nameAr),
    nameEn: scrubAuditText(service.nameEn),
    durationMinutes: service.durationMinutes,
    status: service.status,
  };
}
