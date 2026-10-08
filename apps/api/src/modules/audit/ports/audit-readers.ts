import type {
  ClinicAuditListResponse,
  ClinicAuditQuery,
  PlatformAuditClinicOptionsResponse,
  PlatformAuditListResponse,
  PlatformAuditQuery,
} from "@eyadex/contracts/audit-http";

/** مين بيقرا، وهل صفوف الوصول للمراجعين من حقه (`mayReadPatientAccess`). */
export interface ClinicAuditScope {
  readonly clinicId: string;
  readonly patientAccess: boolean;
}

/** Token الـ DI لقارئ سجل العيادة. */
export const CLINIC_AUDIT_READER = Symbol("audit.ClinicAuditReader");
/** Token الـ DI لقارئ سجل المنصة. */
export const PLATFORM_AUDIT_READER = Symbol("audit.PlatformAuditReader");

/** قراءة سجل العيادة (`eyadex_app` جوه `withTenant`). */
export interface ClinicAuditReader {
  /**
   * صفحة من سجل عيادة واحدة.
   *
   * @param scope العيادة وهل صفوف الوصول للمراجعين مسموحة
   * @param query الـ cursor والحد والفلاتر
   * @returns الصفحة
   */
  list(scope: ClinicAuditScope, query: ClinicAuditQuery): Promise<ClinicAuditListResponse>;
}

/** قراءة سجل المنصة (`eyadex_platform`، من غير عيادة سياق). */
export interface PlatformAuditReader {
  /**
   * صفحة من أحداث المنصة والأحداث الإدارية للعيادات.
   *
   * @param query الـ cursor والحد والفلاتر
   * @returns الصفحة
   */
  list(query: PlatformAuditQuery): Promise<PlatformAuditListResponse>;
  /**
   * كل العيادات بالاسمين لفلتر العيادة.
   *
   * @returns العيادات
   */
  clinicOptions(): Promise<PlatformAuditClinicOptionsResponse>;
}
