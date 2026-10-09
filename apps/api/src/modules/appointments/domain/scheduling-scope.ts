/** فروع الفاعل لفعل واحد: كل الفروع، أو قايمة فروع (نفس شكل `BranchScope` في identity). */
export type Reach =
  { readonly all: true } | { readonly all: false; readonly branchIds: readonly string[] };

/** النطاق اللي الـ guard منح بيه صلاحية الـ route (`ClinicRequest.permissionGrant`). */
export type RouteGrant = "clinic" | "branch" | "own" | undefined;

/** فروع عضو زي ما العضوية بتقولها. */
export interface ProviderReach {
  readonly allBranches: boolean;
  readonly branchIds: readonly string[];
}

/**
 * وصول فعل على الجداول من منحة الـ guard: مفتاح `clinic` = كل الفروع، مفتاح `branch` = فروع العضو.
 * `own` (A3) أو مفيش منحة = مفيش وصول، والرفض هو الافتراضي.
 *
 * @param grant النطاق الممنوح للـ route
 * @param member فروع العضو من سياق الطلب
 * @returns الوصول، أو `null`
 */
export function reachOf(grant: RouteGrant, member: Reach): Reach | null {
  if (grant === "clinic") return { all: true };
  if (grant === "branch") return member;
  return null;
}

/**
 * هل الوصول بيغطي الفرع؟
 *
 * @param reach الوصول
 * @param branchId الفرع
 * @returns `true` لو مغطّي
 */
export function reachCovers(reach: Reach, branchId: string): boolean {
  return reach.all || reach.branchIds.includes(branchId);
}

/**
 * هل مقدّم الخدمة شغّال في فرع واحد على الأقل جوه الوصول؟ برّه الوصول = `not_found` عند المنادي، فمحدش
 * يقدر يستكشف أعضاء فروع تانية.
 *
 * @param reach وصول الفاعل
 * @param provider فروع مقدّم الخدمة
 * @returns `true` لو ظاهر للفاعل
 */
export function providerWithin(reach: Reach, provider: ProviderReach): boolean {
  if (reach.all) return true;
  if (provider.allBranches) return reach.branchIds.length > 0;
  return provider.branchIds.some((id) => reach.branchIds.includes(id));
}

/**
 * فروع مقدّم الخدمة زي ما الفاعل يقدر يشوفها: الفاعل بنطاق الفروع مايعرفش فروع برّه نطاقه، ولا إن
 * العضو شغّال في "كل الفروع"؛ بيشوف بس الفروع المشتركة.
 *
 * @param reach وصول الفاعل
 * @param provider فروع مقدّم الخدمة
 * @returns الفروع اللي تظهر للفاعل
 */
export function branchesWithin(reach: Reach, provider: ProviderReach): ProviderReach {
  if (reach.all) return { allBranches: provider.allBranches, branchIds: [...provider.branchIds] };
  const branchIds = provider.allBranches
    ? [...reach.branchIds]
    : provider.branchIds.filter((id) => reach.branchIds.includes(id));
  return { allBranches: false, branchIds };
}

/**
 * هل مقدّم الخدمة بيشتغل في الفرع ده (عضوية "كل الفروع" أو الفرع في فروعه)؟
 *
 * @param provider فروع مقدّم الخدمة
 * @param branchId الفرع
 * @returns `true` لو بيشتغل فيه
 */
export function providerWorksIn(provider: ProviderReach, branchId: string): boolean {
  return provider.allBranches || provider.branchIds.includes(branchId);
}
