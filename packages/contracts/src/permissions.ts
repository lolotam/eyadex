import { z } from "zod";
import type { ClinicModule } from "./clinics.ts";

export const actionSchema = z.enum(["view", "create", "update", "deactivate", "overbook"]);
export type PermissionAction = z.infer<typeof actionSchema>;

export const resourceSchema = z.enum([
  "branches",
  "users",
  "roles",
  "patients",
  "audit_log",
  "clinic_settings",
  "appointments",
  "services",
  "schedules",
  "visits",
  "medical",
  "medicines",
  "invoices",
  "discounts",
  "prices",
]);
export type PermissionResource = z.infer<typeof resourceSchema>;

/** `clinic` = every branch, `branch` = the member's branches, `own` = the member's own records (A3). */
export const scopeSchema = z.enum(["clinic", "branch", "own"]);
export type PermissionScope = z.infer<typeof scopeSchema>;

/** Permission string: action:resource:scope */
export const permissionSchema = z
  .string()
  .regex(
    /^(view|create|update|deactivate|overbook):(branches|users|roles|patients|audit_log|clinic_settings|appointments|services|schedules|visits|medical|medicines|invoices|discounts|prices):(clinic|branch|own)$/,
  );
export type Permission = string;

export type PermissionDefinition = {
  key: Permission;
  action: PermissionAction;
  resource: PermissionResource;
  scope: PermissionScope;
  /** null = core, always available; otherwise gated by the clinic feature flag. */
  module: ClinicModule | null;
};

const resourceModule: Record<PermissionResource, ClinicModule | null> = {
  branches: null,
  users: null,
  roles: null,
  patients: "patients",
  audit_log: null,
  clinic_settings: null,
  appointments: "appointments",
  services: "appointments",
  schedules: "appointments",
  visits: "medical",
  medical: "medical",
  medicines: "medical",
  invoices: "finance",
  discounts: "finance",
  prices: "finance",
};

type Scopes = readonly PermissionScope[];
const CLINIC: Scopes = ["clinic"];
const BRANCHED: Scopes = ["clinic", "branch"];
const MANAGED = { view: CLINIC, create: CLINIC, update: CLINIC, deactivate: CLINIC };

/**
 * Each resource's actions and the scopes each action takes (PRD 4.7, appointments spec §3); no other
 * combination exists. `own` is a view scope on appointments (the caller's own bookings), on patients
 * (the files with a live appointment with the caller; D-4, slice A3, ADR-0026 A3), on visits and on
 * the medical content (the caller's own visits). On visits it is also the only create scope: the
 * caller starts a visit as its provider (P2 spec). `medical` is a visit's clinical content and the
 * medical file; `medicines` is the clinic's medicines list (P2-F2). Finance (F1 §3.1): `own` views the
 * invoices of the caller's own patients; `deactivate:invoices` is void; `discounts` is changing a
 * discount on an invoice; `prices` covers service and per-doctor prices.
 */
const resourceGrants: Record<PermissionResource, Partial<Record<PermissionAction, Scopes>>> = {
  branches: MANAGED,
  users: MANAGED,
  roles: MANAGED,
  patients: {
    view: ["clinic", "branch", "own"],
    create: BRANCHED,
    update: BRANCHED,
    deactivate: BRANCHED,
  },
  audit_log: { view: CLINIC },
  clinic_settings: { view: CLINIC, update: CLINIC },
  appointments: {
    view: ["clinic", "branch", "own"],
    create: BRANCHED,
    update: BRANCHED,
    overbook: BRANCHED,
  },
  services: MANAGED,
  schedules: { view: BRANCHED, update: BRANCHED },
  visits: { view: ["clinic", "branch", "own"], create: ["own"] },
  medical: { view: ["clinic", "own"], update: ["clinic", "own"] },
  medicines: { view: CLINIC, update: CLINIC },
  invoices: {
    view: ["clinic", "branch", "own"],
    create: BRANCHED,
    update: BRANCHED,
    deactivate: BRANCHED,
  },
  discounts: { create: BRANCHED },
  prices: { view: CLINIC, update: CLINIC },
};

function buildCatalog(): PermissionDefinition[] {
  const list: PermissionDefinition[] = [];
  for (const resource of resourceSchema.options) {
    for (const action of actionSchema.options) {
      for (const scope of resourceGrants[resource][action] ?? []) {
        list.push({
          key: `${action}:${resource}:${scope}`,
          action,
          resource,
          scope,
          module: resourceModule[resource],
        });
      }
    }
  }
  return list;
}

export const PERMISSION_CATALOG: readonly PermissionDefinition[] = buildCatalog();

/**
 * Resources with no view action of their own, and the resource whose view makes them reachable: a discount
 * is a change to an invoice (finance spec R1-14), so `create:discounts` needs `view:invoices`.
 */
export const VIEWED_THROUGH: Readonly<Partial<Record<PermissionResource, PermissionResource>>> = {
  discounts: "invoices",
};

/**
 * Every catalogue key as a literal type, so `@Require(...)` in the API only compiles with a real key.
 * Written out (not derived) on purpose: a test pins it to PERMISSION_CATALOG and to the seeded table.
 */
export const PERMISSION_KEYS = [
  "view:branches:clinic",
  "create:branches:clinic",
  "update:branches:clinic",
  "deactivate:branches:clinic",
  "view:users:clinic",
  "create:users:clinic",
  "update:users:clinic",
  "deactivate:users:clinic",
  "view:roles:clinic",
  "create:roles:clinic",
  "update:roles:clinic",
  "deactivate:roles:clinic",
  "view:patients:clinic",
  "view:patients:branch",
  "view:patients:own",
  "create:patients:clinic",
  "create:patients:branch",
  "update:patients:clinic",
  "update:patients:branch",
  "deactivate:patients:clinic",
  "deactivate:patients:branch",
  "view:audit_log:clinic",
  "view:clinic_settings:clinic",
  "update:clinic_settings:clinic",
  "view:appointments:clinic",
  "view:appointments:branch",
  "view:appointments:own",
  "create:appointments:clinic",
  "create:appointments:branch",
  "update:appointments:clinic",
  "update:appointments:branch",
  "overbook:appointments:clinic",
  "overbook:appointments:branch",
  "view:services:clinic",
  "create:services:clinic",
  "update:services:clinic",
  "deactivate:services:clinic",
  "view:schedules:clinic",
  "view:schedules:branch",
  "update:schedules:clinic",
  "update:schedules:branch",
  "view:visits:clinic",
  "view:visits:branch",
  "view:visits:own",
  "create:visits:own",
  "view:medical:clinic",
  "view:medical:own",
  "update:medical:clinic",
  "update:medical:own",
  "view:medicines:clinic",
  "update:medicines:clinic",
  "view:invoices:clinic",
  "view:invoices:branch",
  "view:invoices:own",
  "create:invoices:clinic",
  "create:invoices:branch",
  "update:invoices:clinic",
  "update:invoices:branch",
  "deactivate:invoices:clinic",
  "deactivate:invoices:branch",
  "create:discounts:clinic",
  "create:discounts:branch",
  "view:prices:clinic",
  "update:prices:clinic",
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];
