import type { ClinicStatus } from "../domain/clinic-access.ts";
import type { FeatureFlag } from "../domain/feature-flags.ts";

/** كل اللي الـ tenancy محتاجه عن عيادة عشان قرار الدخول والحدود والـ flags. */
export interface ClinicSnapshot {
  readonly id: string;
  readonly slug: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly specialty: string;
  readonly defaultLanguage: "ar" | "en";
  readonly timezone: string;
  readonly createdAt: Date;
  readonly status: ClinicStatus;
  readonly expiresAt: Date;
  readonly maxUsers: number;
  readonly maxBranches: number;
  readonly features: readonly FeatureFlag[];
  readonly activeBranches: number;
}

/**
 * قراية العيادة جوه سياقها (`withTenant`). عيادة تانية أو id مش موجود = `null`، مش error.
 * عدّ العضويات والدعوات مش هنا: ورا `SeatUsageReader` اللي بينفّذه identity.
 */
export interface ClinicReader {
  /**
   * يقرا لقطة العيادة.
   *
   * @param clinicId uuid العيادة
   * @returns اللقطة، أو `null` لو العيادة مش ظاهرة في السياق ده
   */
  readSnapshot(clinicId: string): Promise<ClinicSnapshot | null>;
}

/** Token الـ DI للـ ClinicReader. */
export const CLINIC_READER = Symbol("tenancy.ClinicReader");
