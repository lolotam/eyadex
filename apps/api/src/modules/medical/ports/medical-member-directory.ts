import type { Tx } from "@eyadex/db";

/** عضو العيادة زي ما موديول الطب بيشوفه: اسمه وحالته وفروعه. */
export interface MedicalMember {
  readonly membershipId: string;
  readonly fullName: string;
  readonly active: boolean;
  readonly allBranches: boolean;
  readonly branchIds: readonly string[];
}

/**
 * اللي موديول الطب محتاجه من العضويات (ملك identity). identity بتنفّذه (`PgProviderDirectory`، نفس adapter
 * المواعيد)، والربط في `medical.module.ts` بس.
 */
export interface MedicalMemberDirectory {
  /**
   * أعضاء كتير بأي حالة في استعلام واحد (أسماء مقدّمي الخدمة وكتّاب الملاحق).
   *
   * @param tx transaction الطب جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param membershipIds العضويات
   * @returns العضو بتاع كل عضوية لقاها
   */
  findMany(
    tx: Tx,
    clinicId: string,
    membershipIds: readonly string[],
  ): Promise<ReadonlyMap<string, MedicalMember>>;

  /**
   * العضو وصفّه مقفول `FOR SHARE` (ترتيب ADR-0027: بعد قفل مقدّم الخدمة وصف الموعد)، فتعطيله أو تغيير
   * فروعه بالتوازي بيستنى.
   *
   * @param tx transaction الطب وماسكة قفل مقدّم الخدمة
   * @param clinicId العيادة
   * @param membershipId العضوية
   * @returns العضو، أو `null`
   */
  lockForWrite(tx: Tx, clinicId: string, membershipId: string): Promise<MedicalMember | null>;
}
