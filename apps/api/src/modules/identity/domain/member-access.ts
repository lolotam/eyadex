import type { ClinicModule } from "@eyadex/contracts/clinics";
import { PERMISSION_CATALOG } from "@eyadex/contracts/permissions";

import { decideClinicAccess, type ClinicStatus } from "../../tenancy/index.ts";

const MODULE_OF: ReadonlyMap<string, ClinicModule | null> = new Map(
  PERMISSION_CATALOG.map((p) => [p.key, p.module]),
);

/** كل اللي الـ guard محتاجه عن عضو واحد، مقروء مرة من الداتابيز ومتخزّن في الكاش (ADR-0009). */
export interface MemberAccess {
  readonly clinicId: string;
  readonly membershipId: string;
  readonly userId: string;
  readonly status: "active" | "deactivated";
  readonly fullName: string;
  readonly email: string;
  readonly preferredLanguage: "ar" | "en";
  readonly role: {
    readonly id: string;
    readonly nameAr: string;
    readonly nameEn: string;
    readonly isActive: boolean;
  };
  /** مفاتيح الدور من `role_permissions`، مترتبة. */
  readonly permissions: readonly string[];
  readonly allBranches: boolean;
  /** الفروع النشطة المسموحة لما `allBranches = false`. */
  readonly branchIds: readonly string[];
  readonly clinic: {
    readonly nameAr: string;
    readonly nameEn: string;
    readonly timezone: string;
    readonly status: ClinicStatus;
    /** ISO؛ نص عشان يعدّي الكاش زي ما هو. */
    readonly expiresAt: string;
    /** الموديولات اللي ليها صف `clinic_features` مفعّل؛ موديول من غير صف = مقفول (ADR-0010). */
    readonly enabledModules: readonly ClinicModule[];
  };
}

/** نتيجة الخطوتين 1–2 من ترتيب الفحص (PRD §4.7). */
export type MemberDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: "account_disabled" }
  | {
      readonly allowed: false;
      readonly code: "subscription_blocked";
      readonly reason: "suspended" | "expired";
    };

/**
 * العضوية نشطة، وبعدها العيادة مسموح لها دلوقتي (موقوفة أو منتهية = مرفوض). الانتهاء بيتحسب من
 * الـ Clock في كل طلب، فمفيش job ولا كاش يقدر يمدّه (SUB-01، SUB-02).
 *
 * @param member العضو
 * @param now اللحظة من الـ Clock المحقون
 * @returns مسموح، أو سبب الرفض
 */
export function decideMemberAccess(member: MemberAccess, now: Date): MemberDecision {
  if (member.status !== "active") return { allowed: false, code: "account_disabled" };
  const access = decideClinicAccess(
    { status: member.clinic.status, expiresAt: new Date(member.clinic.expiresAt) },
    now,
  );
  if (access !== "allowed") return { allowed: false, code: "subscription_blocked", reason: access };
  return { allowed: true };
}

/**
 * هل الموديول مفعّل للعيادة دي (PRD §4.8)؟ `null` = core، دايمًا مفعّل.
 *
 * @param member العضو
 * @param module الموديول، أو `null`
 * @returns `true` لو مفعّل
 */
export function moduleEnabledFor(member: MemberAccess, module: ClinicModule | null): boolean {
  return module === null || member.clinic.enabledModules.includes(module);
}

/**
 * الصلاحيات الفعلية: دور متعطّل ما بيديش حاجة، ومفتاح موديول مقفول بيختفي (FLAG-01). صفوف
 * `role_permissions` نفسها عمرها ما بتتمسح، فإعادة التفعيل بترجّع نفس الأثر بالظبط (FLAG-02).
 * مفتاح مش في الكتالوج بيتشال كمان (الرفض هو الافتراضي).
 *
 * @param member العضو
 * @returns المفاتيح
 */
export function effectivePermissions(member: MemberAccess): readonly string[] {
  if (!member.role.isActive) return [];
  return member.permissions.filter((key) => {
    const module = MODULE_OF.get(key);
    return module !== undefined && moduleEnabledFor(member, module);
  });
}
