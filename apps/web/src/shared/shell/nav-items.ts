import {
  Building2,
  ReceiptText,
  CalendarDays,
  ClipboardList,
  GitBranch,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Stethoscope,
  UserCircle,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { PermissionResource } from "@eyadex/contracts/permissions";
import type { TranslationKey } from "@/shared/i18n/dictionary";
import { can } from "@/shared/permissions/can";

export type NavPath =
  | "/platform"
  | "/platform/clinics"
  | "/platform/team"
  | "/platform/audit"
  | "/platform/settings"
  | "/clinic"
  | "/clinic/branches"
  | "/clinic/users"
  | "/clinic/roles"
  | "/clinic/patients"
  | "/clinic/appointments"
  | "/clinic/visits"
  | "/clinic/invoices"
  | "/clinic/audit"
  | "/clinic/settings"
  | "/clinic/account";

export type NavItem = {
  to: NavPath;
  label: TranslationKey;
  icon: LucideIcon;
  exact?: boolean;
  /** When set, the item is shown only if the user can view this resource. */
  resource?: PermissionResource;
  /** When set, the item is shown if the user can view any of these resources (a page with tabs). */
  anyOf?: readonly PermissionResource[];
  /** When set, the item needs this exact key (a page whose only action is one key). */
  permission?: string;
};

export const PLATFORM_NAV: NavItem[] = [
  { to: "/platform", label: "nav.overview", icon: LayoutDashboard, exact: true },
  { to: "/platform/clinics", label: "nav.clinics", icon: Building2 },
  { to: "/platform/team", label: "nav.team", icon: UsersRound },
  { to: "/platform/audit", label: "nav.audit", icon: ClipboardList },
  { to: "/platform/settings", label: "nav.settings", icon: Settings },
];

export const CLINIC_NAV: NavItem[] = [
  { to: "/clinic", label: "nav.overview", icon: LayoutDashboard, exact: true },
  { to: "/clinic/branches", label: "nav.branches", icon: GitBranch, resource: "branches" },
  { to: "/clinic/users", label: "nav.users", icon: Users, resource: "users" },
  { to: "/clinic/roles", label: "nav.roles", icon: ShieldCheck, resource: "roles" },
  { to: "/clinic/patients", label: "nav.patients", icon: UsersRound, resource: "patients" },
  // Slice A2: the branch day. The session's keys leave out a module that is off, so the entry needs both.
  // A3: an `own` key opens it too, read-only, showing the caller's own column (ADR-0026 A3).
  {
    to: "/clinic/appointments",
    label: "nav.appointments",
    icon: CalendarDays,
    resource: "appointments",
  },
  // P2: the walk-in visit page, for whoever starts visits as their provider.
  {
    to: "/clinic/visits",
    label: "nav.visits",
    icon: Stethoscope,
    permission: "create:visits:own",
  },
  // Finance F1/F2: the invoices and receipts tabs; their keys vanish with the finance module. A
  // payments-only role lands on the receipts tab (the invoices page sends it there).
  {
    to: "/clinic/invoices",
    label: "nav.invoices",
    icon: ReceiptText,
    anyOf: ["invoices", "payments"],
  },
  { to: "/clinic/audit", label: "nav.audit", icon: ClipboardList, resource: "audit_log" },
  // D-17: the Settings page holds the General, Services and Work schedules tabs.
  {
    to: "/clinic/settings",
    label: "nav.settings",
    icon: Settings,
    anyOf: ["clinic_settings", "services", "prices", "schedules", "medicines"],
  },
  { to: "/clinic/account", label: "nav.account", icon: UserCircle },
];

/** The entries a user may see: by view permission on the entry's resource(s), never by role. */
export function navItemsFor(items: readonly NavItem[], permissions: readonly string[]): NavItem[] {
  return items.filter((item) => {
    if (item.permission) return permissions.includes(item.permission);
    if (item.anyOf) return item.anyOf.some((resource) => can(permissions, "view", resource));
    return !item.resource || can(permissions, "view", item.resource);
  });
}
