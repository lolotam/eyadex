/** فروع العضو: كل الفروع، أو قايمة فروع (نفس شكل `BranchScope` في identity). */
export type MemberBranches =
  { readonly all: true } | { readonly all: false; readonly branchIds: readonly string[] };

/** فاعل على المالية: عيادته وعضويته، مفاتيحه الفعلية (بعد الموديولات المقفولة) وفروعه. */
export interface BillingActor {
  readonly clinicId: string;
  readonly userId: string;
  readonly membershipId: string;
  readonly permissions: readonly string[];
  readonly member: MemberBranches;
}
