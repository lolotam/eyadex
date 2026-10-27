import { randomUUID } from "node:crypto";

import {
  insertBlob,
  insertExport,
  markRunning,
  owner,
  ownerJson,
  readAudits,
  readBlobs,
  readEvent,
  seedExportEvent,
  seedWorld,
  type World,
} from "./export-fixtures.ts";

const q = (value: string) => `'${value.replace(/'/g, "''")}'`;

export function grant(clinicId: string, roleId: string, keys: readonly string[]): void {
  for (const key of keys) {
    const inserted = owner(
      `INSERT INTO role_permissions (clinic_id, id, role_id, permission_id, created_at)
       SELECT ${q(clinicId)}, ${q(randomUUID())}, ${q(roleId)}, p.id, clock_timestamp()
         FROM permissions p WHERE p.key = ${q(key)} RETURNING id`,
    );
    if (inserted === "") throw new Error(`missing permission ${key}`);
  }
}

export function revoke(clinicId: string, roleId: string, key: string): void {
  owner(`DELETE FROM role_permissions rp USING permissions p
          WHERE rp.permission_id = p.id AND rp.clinic_id = ${q(clinicId)}
            AND rp.role_id = ${q(roleId)} AND p.key = ${q(key)}`);
}

export function enableFinance(clinicId: string, enabled = true): void {
  owner(`INSERT INTO clinic_features (clinic_id, id, module, enabled, updated_at)
         VALUES (${q(clinicId)}, ${q(randomUUID())}, 'finance', ${enabled}, clock_timestamp())`);
}

export function setFinance(clinicId: string, enabled: boolean): void {
  owner(`UPDATE clinic_features SET enabled = ${enabled}
          WHERE clinic_id = ${q(clinicId)} AND module = 'finance'`);
}

export function dropFinance(clinicId: string): void {
  owner(`DELETE FROM clinic_features WHERE clinic_id = ${q(clinicId)} AND module = 'finance'`);
}

export function insertBranch(clinicId: string, active: boolean): string {
  const id = randomUUID();
  owner(`INSERT INTO branches (clinic_id, id, name_ar, name_en, is_active, created_at, updated_at)
         VALUES (${q(clinicId)}, ${q(id)}, 'Branch', 'Branch', ${active}, clock_timestamp(), clock_timestamp())`);
  return id;
}

export function assignBranch(clinicId: string, membershipId: string, branchId: string): void {
  owner(`INSERT INTO membership_branches (clinic_id, id, membership_id, branch_id, created_at)
         VALUES (${q(clinicId)}, ${q(randomUUID())}, ${q(membershipId)}, ${q(branchId)}, clock_timestamp())`);
}

export function clearAssignment(clinicId: string, membershipId: string, branchId: string): void {
  owner(`DELETE FROM membership_branches
          WHERE clinic_id = ${q(clinicId)} AND membership_id = ${q(membershipId)} AND branch_id = ${q(branchId)}`);
}

export function deactivateBranch(clinicId: string, branchId: string): void {
  owner(`UPDATE branches SET is_active = false
          WHERE clinic_id = ${q(clinicId)} AND id = ${q(branchId)}`);
}

export function setAllBranches(clinicId: string, membershipId: string, all: boolean): void {
  owner(`UPDATE memberships SET all_branches = ${all}
          WHERE clinic_id = ${q(clinicId)} AND id = ${q(membershipId)}`);
}

export function insertRole(clinicId: string): string {
  const id = randomUUID();
  owner(`INSERT INTO roles (clinic_id, id, system_key, name_ar, name_en, is_locked, is_active, created_at, updated_at)
         VALUES (${q(clinicId)}, ${q(id)}, NULL, 'Role', 'Role', false, true, clock_timestamp(), clock_timestamp())`);
  return id;
}

export function otherMembership(world: World): string {
  const roleId = owner(`SELECT id FROM roles WHERE clinic_id = ${q(world.otherClinicId)} LIMIT 1`);
  const membershipId = randomUUID();
  const email = `other-${membershipId.slice(0, 8)}@example.test`;
  owner(`INSERT INTO email_reservations (email, kind, clinic_id, invitation_id, expires_at, reserved_at)
         VALUES (${q(email)}, 'membership', ${q(world.otherClinicId)}, null, null, clock_timestamp())`);
  owner(`INSERT INTO memberships (clinic_id, id, user_id, full_name, email, role_id, all_branches, status,
           preferred_language, last_login_at, created_at, updated_at)
         VALUES (${q(world.otherClinicId)}, ${q(membershipId)}, ${q(randomUUID())}, 'Member', ${q(email)},
           ${q(roleId)}, true, 'active', 'en', null, clock_timestamp(), clock_timestamp())`);
  return membershipId;
}

export function openMember(keys: readonly string[], allBranches = true): World {
  const world = seedWorld();
  setAllBranches(world.clinicId, world.membershipId, allBranches);
  enableFinance(world.clinicId);
  grant(world.clinicId, world.roleId, keys);
  return world;
}

export function stopRunning(clinicId: string, exportId: string): void {
  owner(`UPDATE finance_report_exports SET status = 'queued', lease_owner = NULL, lease_until = NULL
          WHERE clinic_id = ${q(clinicId)} AND id = ${q(exportId)}`);
}

export function leaseExport(
  world: World,
  input: {
    report: string;
    scope: "clinic" | "branch" | "own";
    branchIds: readonly string[];
    groupBy?: "day" | "month";
    requestedBy?: string;
    lease?: "live" | "expired";
  },
): { exportId: string; params: Record<string, unknown> } {
  const params: Record<string, unknown> = {
    from: "2026-01-01",
    to: "2026-01-31",
    language: "en",
    branchIds: [...input.branchIds],
  };
  if (input.groupBy !== undefined) params["groupBy"] = input.groupBy;
  const exportId = insertExport(world, {
    report: input.report,
    scope: input.scope,
    requestedBy: input.requestedBy ?? world.membershipId,
    params: JSON.stringify(params),
  });
  markRunning(world.clinicId, exportId, {
    attempt: 1,
    owner: "worker-a",
    lease: input.lease ?? "live",
  });
  return { exportId, params };
}

export function controls(clinicId: string, exportId: string, eventId: string) {
  return {
    row: ownerJson<unknown[]>(
      `SELECT to_jsonb(e) AS row FROM finance_report_exports e
        WHERE clinic_id = ${q(clinicId)} AND id = ${q(exportId)}`,
    ),
    blobs: readBlobs(clinicId, exportId),
    audits: readAudits(clinicId, exportId),
    event: readEvent(eventId),
  };
}

export function seedControls(clinicId: string, exportId: string): string {
  insertBlob(clinicId, exportId, 1, "allocated", "csv");
  owner(`INSERT INTO audit_log (clinic_id, id, actor_user_id, action, category, entity_type, entity_id,
           branch_id, details, created_at)
         VALUES (${q(clinicId)}, ${q(randomUUID())}, ${q(randomUUID())}, 'finance_report.exported',
           'administrative', 'finance_report_export', ${q(exportId)}, NULL, '{"report":"daily_takings"}'::jsonb,
           clock_timestamp())`);
  return seedExportEvent(clinicId, exportId);
}
