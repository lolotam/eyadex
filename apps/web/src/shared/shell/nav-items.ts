import {
  Building2,
  CalendarDays,
  ClipboardList,
  GitBranch,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  UserCircle,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { PermissionResource, PermissionScope } from "@eyadex/contracts/permissions";
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
  /** When set, the view key on `resource` counts only in these scopes. */
  scopes?: readonly PermissionScope[];
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
  // Its reads need a branch or clinic key: an `own` key alone shows no entry (Codex PR #64).
  {
    to: "/clinic/appointments",
    label: "nav.appointments",
    icon: CalendarDays,
    resource: "appointments",
    scopes: ["clinic", "branch"],
  },
  { to: "/clinic/audit", label: "nav.audit", icon: ClipboardList, resource: "audit_log" },
  // D-17: the Settings page holds the General, Services and Work schedules tabs.
  {
    to: "/clinic/settings",
    label: "nav.settings",
    icon: Settings,
    anyOf: ["clinic_settings", "services", "schedules"],
  },
  { to: "/clinic/account", label: "nav.account", icon: UserCircle },
];

/** The entries a user may see: by view permission on the entry's resource(s), never by role. */
export function navItemsFor(items: readonly NavItem[], permissions: readonly string[]): NavItem[] {
  return items.filter((item) => {
    if (item.anyOf) return item.anyOf.some((resource) => can(permissions, "view", resource));
    return !item.resource || can(permissions, "view", item.resource, item.scopes);
  });
}
