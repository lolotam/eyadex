/** مفتاح دور نظام (0004). */
export type SystemRoleKey = "clinic_admin" | "doctor" | "receptionist" | "technician";

/** تعريف دور نظام بيتزرع مع كل عيادة جديدة (PRD §4.7). */
export interface SystemRoleTemplate {
  readonly key: SystemRoleKey;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly isLocked: boolean;
  readonly permissions: readonly string[];
}

const clinicScope = [
  ...["view", "create", "update", "deactivate"].flatMap((action) =>
    ["branches", "users", "roles", "patients"].map((resource) => `${action}:${resource}:clinic`),
  ),
  "view:audit_log:clinic",
  "view:clinic_settings:clinic",
  "update:clinic_settings:clinic",
];

/**
 * الأدوار الجاهزة: أدمن العيادة (كل الكتالوج بنطاق clinic، مقفول) والتلاتة القابلين للتعديل
 * بصلاحياتهم المؤقتة (OD-4). نفس الأسماء بتاعة الـ mock في الويب.
 */
export const SYSTEM_ROLES: readonly SystemRoleTemplate[] = [
  {
    key: "clinic_admin",
    nameAr: "مدير العيادة",
    nameEn: "Clinic Admin",
    isLocked: true,
    permissions: clinicScope,
  },
  {
    key: "doctor",
    nameAr: "طبيب",
    nameEn: "Doctor",
    isLocked: false,
    permissions: ["view:patients:branch"],
  },
  {
    key: "receptionist",
    nameAr: "موظف استقبال",
    nameEn: "Receptionist",
    isLocked: false,
    permissions: ["view:patients:branch", "create:patients:branch", "update:patients:branch"],
  },
  {
    key: "technician",
    nameAr: "فني",
    nameEn: "Technician",
    isLocked: false,
    permissions: ["view:patients:branch"],
  },
];

/** OD-3: رابط الدعوة صالح 7 أيام. */
export const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * تاريخ انتهاء الدعوة من وقت إنشائها.
 *
 * @param now وقت الإنشاء
 * @returns بعد 7 أيام بالظبط
 */
export function invitationExpiry(now: Date): Date {
  return new Date(now.getTime() + INVITATION_LIFETIME_MS);
}
