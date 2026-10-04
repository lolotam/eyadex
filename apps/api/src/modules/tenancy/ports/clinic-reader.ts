import type { ClinicStatus } from "../domain/clinic-access.ts";
import type { FeatureFlag, } from "../domain/feature-flags.ts";
import type { PendingInvitation } from "../domain/limits.ts";

/** كل اللي الـ tenancy محتاجه عن عيادة عشان قرار الدخول والحدود والـ flags. */
export interface ClinicSnapshot {
  readonly id: string;
  readonly slug: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly status: ClinicStatus;
  readonly expiresAt: Date;
  readonly maxUsers: number;
  readonly maxBranches: number;
  readonly features: readonly FeatureFlag[];
  readonly activeMemberships: number;
  /** الدعوات اللي حالتها المخزّنة pending — السريان بيتحسب في الـ domain. */
  readonly pendingInvitations: readonly PendingInvitation[];
  readonly activeBranches: number;
}

/**
 * قراية العيادة جوه سياقها (`withTenant`). عيادة تانية أو id مش موجود = `null`، مش error.
 * TODO(spec): عدّ العضويات والدعوات بيقرا جداول الـ identity؛ لما موديول identity يتبني العدّ ده
 * ينتقل ورا port بيوفّره identity (CLAUDE.architecture.md §2.2).
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
