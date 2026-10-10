import { PERMISSION_CATALOG, type PermissionResource } from "@eyadex/contracts/permissions";
import type { Role, SystemRoleKey } from "@eyadex/contracts/organization";

type RoleTemplate = { nameAr: string; nameEn: string; isLocked: boolean; permissions: string[] };

// P2 R1-4, as the API's SYSTEM_ROLES: the medical module's keys reach roles only at its release.
const UNRELEASED: ReadonlySet<PermissionResource> = new Set(["visits", "medical", "medicines"]);

export const ROLE_TEMPLATES: Record<SystemRoleKey, RoleTemplate> = {
  clinic_admin: {
    nameAr: "مدير العيادة",
    nameEn: "Clinic Admin",
    isLocked: true,
    permissions: PERMISSION_CATALOG.filter(
      (p) => p.scope === "clinic" && !UNRELEASED.has(p.resource),
    ).map((p) => p.key),
  },
  doctor: {
    nameAr: "طبيب",
    nameEn: "Doctor",
    isLocked: false,
    // D-8 (spec §3, slice A3): its own appointments and its own patients only, as the API's SYSTEM_ROLES.
    permissions: ["view:appointments:own", "view:patients:own"],
  },
  receptionist: {
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
    ],
  },
  technician: {
    nameAr: "فني",
    nameEn: "Technician",
    isLocked: false,
    permissions: ["view:patients:branch"],
  },
};

export const SYSTEM_ROLE_KEYS: SystemRoleKey[] = [
  "clinic_admin",
  "doctor",
  "receptionist",
  "technician",
];

export function buildSystemRoles(clinicId: string, makeId: () => string): Role[] {
  return SYSTEM_ROLE_KEYS.map((key) => {
    const template = ROLE_TEMPLATES[key];
    return {
      id: makeId(),
      clinicId,
      systemKey: key,
      nameAr: template.nameAr,
      nameEn: template.nameEn,
      isLocked: template.isLocked,
      isActive: true,
      permissions: [...template.permissions],
    };
  });
}
