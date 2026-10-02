import {
  Building2,
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
import type { PermissionResource } from "@contracts/permissions";
import type { TranslationKey } from "@/shared/i18n/dictionary";

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
  { to: "/clinic/audit", label: "nav.audit", icon: ClipboardList, resource: "audit_log" },
  { to: "/clinic/settings", label: "nav.settings", icon: Settings, resource: "clinic_settings" },
  { to: "/clinic/account", label: "nav.account", icon: UserCircle },
];
