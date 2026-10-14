import type { PermissionKey } from "@eyadex/contracts/permissions";

import { grantFor } from "./permission-check.ts";

/** وصول عضو أو دعوة للفروع: كل الفروع، أو قايمة فروع. */
export interface BranchReach {
  readonly allBranches: boolean;
  readonly branchIds: readonly string[];
}

/**
 * الفاعل كما اتقري من الداتابيز جوه transaction الكتابة، بعد أقفال العيادة (ADR-0017 §6): مش من
 * سياق الطلب، لأن ده متفلتر بالموديولات ومتخزّن في الكاش لحد 30 ثانية.
 */
export interface GrantingMember {
  /** العضوية نشطة ودورها نشط. */
  readonly active: boolean;
  /** مفاتيح دوره المخزّنة، بكل الموديولات (المقفول منها كمان). */
  readonly keys: readonly string[];
  /** فروعه: كل الفروع، أو فروعه النشطة بس. */
  readonly reach: BranchReach;
  /** دوره هو دور أدمن العيادة المقفول (`is_locked`)، صاحب تفويض المفاتيح الطبية (P2 R1-2). */
  readonly lockedRole: boolean;
}

// ADR-0026 §12 (Codex A3 r1): a file is "own" by its appointments, in any branch, so a branch key does not
// bound view:patients:own (a branch manager could hand a member files of every branch). Only the clinic
// key covers it when granting; the route guard's grantFor is unchanged (a wider key held still wins).
// P2 R1-3: the visits and medical `own` keys reach the caller's patients the same way (appointments or
// visits in any branch), so they are bound to their clinic keys too.
const CLINIC_BOUND: ReadonlyMap<string, string> = new Map([
  ["view:patients:own", "view:patients:clinic"],
  ["view:visits:own", "view:visits:clinic"],
  ["view:medical:own", "view:medical:clinic"],
  ["update:medical:own", "update:medical:clinic"],
  // Finance F1 (spec R1-12): invoices of the caller's own patients reach every branch the same way.
  ["view:invoices:own", "view:invoices:clinic"],
]);

// P2 R1-2 (spec §2, P2-5): the locked clinic admin does not read clinical content by default, yet it is
// the one who sets up the doctors' roles. It may hand these resources' keys to other roles without
// holding them; nobody else grants a key it lacks, and no member can change its own role (user-changes).
const ADMIN_DELEGATED: ReadonlySet<string> = new Set(["visits", "medical"]);

/**
 * المفاتيح المطلوبة اللي مفاتيح الفاعل المخزّنة ماتغطيهاش. مفتاح `clinic` بيغطي نفس الفعل والمورد
 * بنطاق `branch` (زي `grantFor`)، والعكس لأ. مفاتيح `own` اللي بتعدّي الفروع (`view:patients:own`
 * ومفاتيح الزيارات والمحتوى الطبي) مفتاح `clinic` بتاعها بس اللي بيغطيها. أدمن العيادة المقفول بيمنح
 * مفاتيح `visits` و`medical` من غير ما يكون شايلها (تفويض محدود). مفيش فلترة بالموديولات: مفتاح موديول
 * مقفول بيرجع أثره لما الموديول يتفتح، فبيتحسب.
 *
 * @param held مفاتيح دور الفاعل المخزّنة
 * @param wanted مفاتيح الدور المستهدف
 * @param lockedRole دور الفاعل هو دور أدمن العيادة المقفول
 * @returns المفاتيح اللي مش متغطية، مترتبة؛ فاضية = متغطية كلها
 */
export function uncoveredKeys(
  held: readonly string[],
  wanted: readonly string[],
  lockedRole = false,
): string[] {
  const covered = (key: string) => {
    if (lockedRole && ADMIN_DELEGATED.has(key.split(":")[1] ?? "")) return true;
    const bound = CLINIC_BOUND.get(key);
    if (bound !== undefined) return held.includes(bound);
    // Stored keys reference the catalogue (FK to permissions), so each one is a PermissionKey.
    return grantFor(held, key as PermissionKey) !== null;
  };
  return [...new Set(wanted)].filter((key) => !covered(key)).sort();
}

/**
 * هل وصول الهدف للفروع جوه وصول الفاعل؟ هدف على كل الفروع محتاج فاعل على كل الفروع؛ غير كده
 * فروع الهدف لازم تكون من فروع الفاعل.
 *
 * @param target وصول العضو أو الدعوة
 * @param actor وصول الفاعل
 * @returns `true` لو جوه
 */
export function reachWithin(target: BranchReach, actor: BranchReach): boolean {
  if (actor.allBranches) return true;
  if (target.allBranches) return false;
  const mine = new Set(actor.branchIds);
  return target.branchIds.every((id) => mine.has(id));
}

/**
 * هل الفاعل، كما هو في الداتابيز دلوقتي، لسه شايل صلاحية الـ route نفسها؟ الـ guard قررها قبل ما
 * الطلب يستنى القفل، وممكن تكون اتشالت وهو مستني (ADR-0017 §6). مفتاح `clinic` بيغطي `branch`.
 *
 * @param actor الفاعل من الداتابيز، أو `null` لو مالوش عضوية
 * @param required الصلاحية اللي الـ route طالبها
 * @returns `allowed` أو `forbidden`
 */
export function decideActorPermission(
  actor: GrantingMember | null,
  required: PermissionKey,
): "allowed" | "forbidden" {
  if (actor === null || !actor.active) return "forbidden";
  return grantFor(actor.keys, required) === null ? "forbidden" : "allowed";
}

/**
 * كتابة تعريف دور (إنشاء، تعديل، تعطيل، إعادة تفعيل). TODO(spec): نموذج تفويض أوسع محتاج قرار
 * المالك. القراءة المتحفظة: الدور كيان على مستوى العيادة، فالفاعل لازم يكون على كل الفروع، ومفاتيحه
 * المخزّنة تغطي مفاتيح الدور المستهدف كلها. فحص صلاحيات ونطاق، مش فحص اسم دور.
 *
 * @param actor الفاعل من الداتابيز، أو `null` لو مالوش عضوية
 * @param required صلاحية الـ route، بتتعاد هنا على المفاتيح المقروءة دلوقتي
 * @param roleKeys مفاتيح الدور المستهدف (قبل الكتابة وبعدها)
 * @returns `allowed` أو `forbidden`
 */
export function decideRoleDefinition(
  actor: GrantingMember | null,
  required: PermissionKey,
  roleKeys: readonly string[],
): "allowed" | "forbidden" {
  if (decideActorPermission(actor, required) === "forbidden") return "forbidden";
  if (actor === null || !actor.reach.allBranches) return "forbidden";
  return uncoveredKeys(actor.keys, roleKeys, actor.lockedRole).length === 0
    ? "allowed"
    : "forbidden";
}

/**
 * منح دور لحد (تغيير الدور، تغيير الفروع، دعوة، إعادة إرسال أو نسخ رابط، إعادة تفعيل عضو): مفاتيح
 * الفاعل المخزّنة تغطي مفاتيح الدور، ووصول الهدف للفروع جوه وصول الفاعل.
 *
 * @param actor الفاعل من الداتابيز، أو `null` لو مالوش عضوية
 * @param required صلاحية الـ route، بتتعاد هنا على المفاتيح المقروءة دلوقتي
 * @param roleKeys مفاتيح الدور اللي بيتمنح، المخزّنة
 * @param target وصول العضو أو الدعوة للفروع بعد العملية
 * @returns `allowed` أو `forbidden`
 */
export function decideRoleGrant(
  actor: GrantingMember | null,
  required: PermissionKey,
  roleKeys: readonly string[],
  target: BranchReach,
): "allowed" | "forbidden" {
  if (decideActorPermission(actor, required) === "forbidden" || actor === null) return "forbidden";
  if (uncoveredKeys(actor.keys, roleKeys, actor.lockedRole).length > 0) return "forbidden";
  return reachWithin(target, actor.reach) ? "allowed" : "forbidden";
}
