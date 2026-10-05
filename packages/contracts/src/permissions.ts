import { z } from "zod";
import type { ClinicModule } from "./clinics.ts";

export const actionSchema = z.enum(["view", "create", "update", "deactivate"]);
export type PermissionAction = z.infer<typeof actionSchema>;

export const resourceSchema = z.enum([
  "branches",
  "users",
  "roles",
  "patients",
  "audit_log",
  "clinic_settings",
]);
export type PermissionResource = z.infer<typeof resourceSchema>;

export const scopeSchema = z.enum(["clinic", "branch"]);
export type PermissionScope = z.infer<typeof scopeSchema>;

/** Permission string: action:resource:scope */
export const permissionSchema = z
  .string()
  .regex(
    /^(view|create|update|deactivate):(branches|users|roles|patients|audit_log|clinic_settings):(clinic|branch)$/,
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
};

/** The actions each resource defines (PRD 4.7); no other action exists for it. */
const resourceActions: Record<PermissionResource, readonly PermissionAction[]> = {
  branches: ["view", "create", "update", "deactivate"],
  users: ["view", "create", "update", "deactivate"],
  roles: ["view", "create", "update", "deactivate"],
  patients: ["view", "create", "update", "deactivate"],
  audit_log: ["view"],
  clinic_settings: ["view", "update"],
};

function buildCatalog(): PermissionDefinition[] {
  const list: PermissionDefinition[] = [];
  for (const resource of resourceSchema.options) {
    const scopes: PermissionScope[] = resource === "patients" ? ["clinic", "branch"] : ["clinic"];
    for (const action of resourceActions[resource]) {
      for (const scope of scopes) {
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
