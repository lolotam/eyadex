import type { Tx } from "@eyadex/db";

/** عضو العيادة زي ما موديول المواعيد بيشوفه (D-1). */
export interface ProviderRecord {
  readonly membershipId: string;
  readonly fullName: string;
  readonly active: boolean;
  readonly acceptsAppointments: boolean;
  readonly defaultDurationMinutes: number;
  readonly allBranches: boolean;
  readonly branchIds: readonly string[];
}

/**
 * اللي موديول المواعيد محتاجه من العضويات (ملك identity)، جوه الـ transaction بتاعته. الـ port ده بتاع
 * المواعيد، و identity بتنفّذه (`PgProviderDirectory`)، والربط في `appointments.module.ts` بس.
 */
export interface ProviderDirectory {
  /**
   * عضو واحد بأي حالة.
   *
   * @param tx transaction المواعيد جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param membershipId العضوية
   * @returns العضو، أو `null` لو مش عضو في العيادة دي
   */
  find(tx: Tx, clinicId: string, membershipId: string): Promise<ProviderRecord | null>;

  /**
   * الأعضاء القابلين للحجز (نشطين و"يستقبل مواعيد")، مرتبين بالاسم.
   *
   * @param tx transaction المواعيد جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @returns الأعضاء
   */
  listBookable(tx: Tx, clinicId: string): Promise<readonly ProviderRecord[]>;
}
