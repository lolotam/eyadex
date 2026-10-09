import {
  PERMISSION_CATALOG,
  type PermissionAction,
  type PermissionResource,
} from "@eyadex/contracts/permissions";
import { ROLE_TEMPLATES } from "@/shared/api/mock/seed-roles";

export type KeyId = "admin" | "doctor" | "receptionist" | "tech" | "team";
export type BranchId = "salmiya" | "hawalli";

export const KEY_ORDER: readonly KeyId[] = ["admin", "doctor", "receptionist", "tech", "team"];
export const BRANCHES: readonly BranchId[] = ["salmiya", "hawalli"];
// The landing's sample clinic shows the MVP areas only, not every resource of the catalogue.
export const SIDEBAR_ORDER = [
  "overview",
  "branches",
  "users",
  "roles",
  "patients",
  "audit_log",
  "clinic_settings",
] as const satisfies readonly ("overview" | PermissionResource)[];
export type SidebarItem = (typeof SIDEBAR_ORDER)[number];

type SamplePersona = { permissions: readonly string[]; branches: readonly BranchId[] };

/** Default role permissions come straight from ROLE_TEMPLATES, so the demo matches a new clinic. */
export const SAMPLE_PERSONAS: Record<KeyId, SamplePersona> = {
  admin: { permissions: ROLE_TEMPLATES.clinic_admin.permissions, branches: BRANCHES },
  doctor: { permissions: ROLE_TEMPLATES.doctor.permissions, branches: ["salmiya"] },
  receptionist: { permissions: ROLE_TEMPLATES.receptionist.permissions, branches: ["salmiya"] },
  tech: { permissions: ROLE_TEMPLATES.technician.permissions, branches: ["hawalli"] },
  /** The platform has no grant on any clinic resource. */
  team: { permissions: [], branches: [] },
};

export type SamplePatient = { file: number; branch: BranchId; phone: string; index: number };
export const SAMPLE_PATIENTS: readonly SamplePatient[] = [
  { file: 1041, branch: "salmiya", phone: "+965 5••• ••37", index: 0 },
  { file: 1042, branch: "salmiya", phone: "+965 6••• ••02", index: 1 },
  { file: 1043, branch: "salmiya", phone: "+965 9••• ••81", index: 2 },
  { file: 1044, branch: "hawalli", phone: "+965 5••• ••46", index: 3 },
  { file: 1045, branch: "hawalli", phone: "+965 6••• ••19", index: 4 },
  { file: 1046, branch: "hawalli", phone: "+965 9••• ••73", index: 5 },
];

const KNOWN = new Set(PERMISSION_CATALOG.map((p) => p.key));

function holds(
  perms: readonly string[],
  action: PermissionAction,
  resource: PermissionResource,
  scope?: "clinic" | "branch",
) {
  return perms.some((p) => KNOWN.has(p) && p.startsWith(`${action}:${resource}:${scope ?? ""}`));
}

export type KeyringView = {
  sidebar: SidebarItem[];
  scope: "all" | "branch" | "none";
  branches: readonly BranchId[];
  rows: { patient: SamplePatient; visible: boolean }[];
  buttons: { create: boolean; update: boolean; deactivate: boolean };
  openFile: number | null;
  refused: boolean;
};

export function computeView(key: KeyId): KeyringView {
  const { permissions, branches } = SAMPLE_PERSONAS[key];
  const sidebar = SIDEBAR_ORDER.filter(
    (item) => item === "overview" || holds(permissions, "view", item),
  );
  const scope = holds(permissions, "view", "patients", "clinic")
    ? "all"
    : holds(permissions, "view", "patients", "branch")
      ? "branch"
      : "none";
  const rows = SAMPLE_PATIENTS.map((patient) => ({
    patient,
    visible: scope === "all" || (scope === "branch" && branches.includes(patient.branch)),
  }));
  const canSee = scope !== "none";
  const buttons = {
    create: canSee && holds(permissions, "create", "patients"),
    update: canSee && holds(permissions, "update", "patients"),
    deactivate: canSee && holds(permissions, "deactivate", "patients"),
  };
  const visible = rows.filter((r) => r.visible).map((r) => r.patient.file);
  const openFile = visible.includes(1042) ? 1042 : (visible[0] ?? null);
  return { sidebar, scope, branches, rows, buttons, openFile, refused: !canSee };
}

export type CaptionParts = {
  all: string;
  branch: string;
  none: string;
  can: string;
  viewOnly: string;
  and: string;
  sep: string;
  add: string;
  edit: string;
  archive: string;
};

/** One caption sentence derived from the computed view, never hand-written per role. */
export function buildCaption(
  view: KeyringView,
  c: CaptionParts,
  branchName: (b: BranchId) => string,
): string {
  if (view.scope === "none") return c.none;
  const subject =
    view.scope === "all"
      ? c.all
      : c.branch.replace("{branch}", view.branches.map(branchName).join(c.and));
  const abilities = [
    view.buttons.create && c.add,
    view.buttons.update && c.edit,
    view.buttons.deactivate && c.archive,
  ].filter((x): x is string => Boolean(x));
  if (abilities.length === 0) return subject + c.viewOnly;
  const firstAbility = abilities[0];
  if (!firstAbility) return subject + c.viewOnly;
  const list =
    abilities.length === 1
      ? firstAbility
      : `${abilities.slice(0, -1).join(c.sep)}${c.and}${abilities.at(-1)}`;
  return subject + c.can.replace("{list}", list);
}
