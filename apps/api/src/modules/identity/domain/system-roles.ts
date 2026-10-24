import { PERMISSION_CATALOG, type PermissionResource } from "@eyadex/contracts/permissions";

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

// PRD §5.3 "Clinic Admin (locked, everything)": every clinic-scope key of the catalogue, so a key the
// catalogue gains reaches new clinics' admins with no second list (ADR-0026 §6). Same rule as the web
// mock's ROLE_TEMPLATES. P2-5: never the clinical content; the admin hands those keys to other roles
// through its bounded delegation (R1-2). Existing clinics got the same keys from 0050 (R1-16).
const NOT_FOR_ADMIN: ReadonlySet<PermissionResource> = new Set(["medical"]);
const clinicScope = PERMISSION_CATALOG.filter(
  (p) => p.scope === "clinic" && !NOT_FOR_ADMIN.has(p.resource),
).map((p) => p.key);

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
    // D-8 (spec §3, slice A3): its own appointments and its own patients; booking stays with the front
    // desk. P2 spec §2: it starts its own visits and reads and writes its own patients' medical content.
    permissions: [
      "view:appointments:own",
      "view:patients:own",
      "view:visits:own",
      "create:visits:own",
      "view:medical:own",
      "update:medical:own",
      "view:medicines:clinic",
      // Finance F1 (FIN-4): the invoices of its own patients, read only.
      "view:invoices:own",
      // Finance F3 (F3-Q9, EY-10.1): the summary of its own billed lines (R10), nothing more.
      "view:report_own:own",
    ],
  },
  {
    key: "receptionist",
    nameAr: "موظف استقبال",
    nameEn: "Receptionist",
    isLocked: false,
    permissions: [
      "view:patients:branch",
      "create:patients:branch",
      "update:patients:branch",
      // Owner decision 2026-10-10 (A2, spec §3): the front desk books in its branches.
      "view:appointments:branch",
      "create:appointments:branch",
      "update:appointments:branch",
      "view:schedules:branch",
      "view:services:clinic",
      // P2-K4: the front desk sees that a visit exists, never its content.
      "view:visits:branch",
      // Finance F1 (FIN-4): the front desk invoices in its branches and reads prices.
      "view:invoices:branch",
      "create:invoices:branch",
      "update:invoices:branch",
      "view:prices:clinic",
      // Finance F2 (F2-Q15): the front desk records payments and closes its branches' cash; refunds stay with the admin.
      "view:payments:branch",
      "create:payments:branch",
      "view:cash_closings:branch",
      "create:cash_closings:branch",
      // Finance F3 (EY-9.14 a, EY-10.1): its branches' takings, period summary and closings (R1, R2, R9).
      "view:report_takings:branch",
    ],
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
