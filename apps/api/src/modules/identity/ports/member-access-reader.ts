import type { MemberAccess } from "../domain/member-access.ts";

/** قراءة العضو من الداتابيز، من غير كاش. */
export interface MemberAccessReader {
  /**
   * عيادة المستخدم قبل أي سياق عيادة (`membership_clinic_for_user`، 0027).
   *
   * @param userId id حساب Better Auth
   * @returns الـ id أو `null` لو ملوش عضوية
   */
  clinicForUser(userId: string): Promise<string | null>;
  /**
   * العضو جوه `withTenant(clinicId)`: RLS بيضمن إنه ما يشوفش غير العيادة دي.
   *
   * @param clinicId العيادة
   * @param userId المستخدم
   * @returns العضو أو `null`
   */
  readMember(clinicId: string, userId: string): Promise<MemberAccess | null>;
}

/** Token الـ DI. */
export const MEMBER_ACCESS_READER = Symbol("identity.MemberAccessReader");
