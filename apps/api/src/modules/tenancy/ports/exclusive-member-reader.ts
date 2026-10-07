import type { Tx } from "@eyadex/db";

/** عضو معتمد على فرع واحد بس (للرسالة: الاسم والـ id بس). */
export interface ExclusiveMember {
  readonly id: string;
  readonly fullName: string;
}

/**
 * الأعضاء اللي هيفضلوا من غير فرع نشط لو الفرع ده اتعطّل (ADR-0012). `identity` بيملك جداول
 * العضويات فهو اللي بينفّذه؛ `tenancy` بيستخدمه جوه transaction الفرع.
 */
export interface ExclusiveMemberReader {
  /**
   * الأعضاء النشطين (مش `all_branches`) اللي الفرع ده هو فرعهم النشط الوحيد.
   *
   * @param tx الـ transaction جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param branchId الفرع
   * @returns الأعضاء مرتبين بالـ id
   */
  members(tx: Tx, clinicId: string, branchId: string): Promise<readonly ExclusiveMember[]>;
  /**
   * نفس العدّ لكذا فرع مرة واحدة (للقوايم).
   *
   * @param tx الـ transaction
   * @param clinicId العيادة
   * @param branchIds الفروع
   * @returns العدد لكل فرع؛ الفرع اللي مش موجود عدده 0
   */
  counts(tx: Tx, clinicId: string, branchIds: readonly string[]): Promise<Map<string, number>>;
}
