import type { Tx } from "@eyadex/db";

/**
 * اللي موديول الطب محتاجه من جدول العيادات (ملك tenancy): الاسمين لطباعة الروشتة. tenancy بتنفّذه
 * (`PgClinicNames`)، والربط في `medical.module.ts`.
 */
export interface MedicalClinicReader {
  /**
   * أسماء العيادات في جملة واحدة (الـ RLS بيظهر عيادة السياق بس).
   *
   * @param tx transaction الطب جوه `withTenant(clinicId)`
   * @param clinicIds العيادات
   * @returns الاسمين لكل عيادة ظاهرة
   */
  namesOf(
    tx: Tx,
    clinicIds: readonly string[],
  ): Promise<ReadonlyMap<string, { nameAr: string; nameEn: string }>>;
}
