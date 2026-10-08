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
}

/**
 * المفاتيح المطلوبة اللي مفاتيح الفاعل المخزّنة ماتغطيهاش. مفتاح `clinic` بيغطي نفس الفعل والمورد
 * بنطاق `branch` (زي `grantFor`)، والعكس لأ. مفيش فلترة بالموديولات: مفتاح موديول مقفول بيرجع
 * أثره لما الموديول يتفتح، فبيتحسب.
 *
 * @param held مفاتيح دور الفاعل المخزّنة
 * @param wanted مفاتيح الدور المستهدف
 * @returns المفاتيح اللي مش متغطية، مترتبة؛ فاضية = متغطية كلها
 */
export function uncoveredKeys(held: readonly string[], wanted: readonly string[]): string[] {
  // Stored keys reference the catalogue (FK to permissions), so each one is a PermissionKey.
  return [...new Set(wanted)].filter((key) => grantFor(held, key as PermissionKey) === null).sort();
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
 * كتابة تعريف دور (إنشاء، تعديل، تعطيل، إعادة تفعيل). TODO(spec): نموذج تفويض أوسع محتاج قرار
 * المالك. القراءة المتحفظة: الدور كيان على مستوى العيادة، فالفاعل لازم يكون على كل الفروع، ومفاتيحه
 * المخزّنة تغطي مفاتيح الدور المستهدف كلها. فحص صلاحيات ونطاق، مش فحص اسم دور.
 *
 * @param actor الفاعل من الداتابيز، أو `null` لو مالوش عضوية
 * @param roleKeys مفاتيح الدور المستهدف (قبل الكتابة وبعدها)
 * @returns `allowed` أو `forbidden`
 */
export function decideRoleDefinition(
  actor: GrantingMember | null,
  roleKeys: readonly string[],
): "allowed" | "forbidden" {
  if (actor === null || !actor.active || !actor.reach.allBranches) return "forbidden";
  return uncoveredKeys(actor.keys, roleKeys).length === 0 ? "allowed" : "forbidden";
}

/**
 * منح دور لحد (تغيير الدور، تغيير الفروع، دعوة، إعادة إرسال أو نسخ رابط، إعادة تفعيل عضو): مفاتيح
 * الفاعل المخزّنة تغطي مفاتيح الدور، ووصول الهدف للفروع جوه وصول الفاعل.
 *
 * @param actor الفاعل من الداتابيز، أو `null` لو مالوش عضوية
 * @param roleKeys مفاتيح الدور اللي بيتمنح، المخزّنة
 * @param target وصول العضو أو الدعوة للفروع بعد العملية
 * @returns `allowed` أو `forbidden`
 */
export function decideRoleGrant(
  actor: GrantingMember | null,
  roleKeys: readonly string[],
  target: BranchReach,
): "allowed" | "forbidden" {
  if (actor === null || !actor.active) return "forbidden";
  if (uncoveredKeys(actor.keys, roleKeys).length > 0) return "forbidden";
  return reachWithin(target, actor.reach) ? "allowed" : "forbidden";
}
