import { PERMISSION_CATALOG } from "@contracts/permissions";
import type { Role, SystemRoleKey } from "@contracts/organization";

type RoleTemplate = { nameAr: string; nameEn: string; isLocked: boolean; permissions: string[] };

export const ROLE_TEMPLATES: Record<SystemRoleKey, RoleTemplate> = {
  clinic_admin: {
    nameAr: "مدير العيادة",
    nameEn: "Clinic Admin",
    isLocked: true,
    permissions: PERMISSION_CATALOG.filter((p) => p.scope === "clinic").map((p) => p.key),
  },
  doctor: {
    nameAr: "طبيب",
    nameEn: "Doctor",
    isLocked: false,
    permissions: ["view:patients:branch", "create:patients:branch", "update:patients:branch"],
  },
  receptionist: {
    nameAr: "موظف استقبال",
    nameEn: "Receptionist",
    isLocked: false,
    permissions: ["view:patients:branch", "create:patients:branch"],
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
