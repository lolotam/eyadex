import { decideClinicAccess, type ClinicStatus } from "../../tenancy/index.ts";

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
 * الصلاحيات الفعلية: دور متعطّل ما بيديش حاجة (المفروض مايحصلش لعضو نشط — PRD §4.7 — بس الرفض هو
 * الافتراضي).
 *
 * @param member العضو
 * @returns المفاتيح
 */
export function effectivePermissions(member: MemberAccess): readonly string[] {
  return member.role.isActive ? member.permissions : [];
}
