import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import type { Logger } from "@eyadex/observability";

const need = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
};

export const urls = () => ({
  owner: need("EYADEX_TEST_OWNER_URL"),
  app: need("EYADEX_TEST_APP_URL"),
  dispatcher: need("EYADEX_TEST_DISPATCHER_URL"),
});

/** Owner setup and inspection only. Use-case calls go through eyadex_app. */
export function owner(query: string): string {
  return execFileSync("psql", [urls().owner, "-v", "ON_ERROR_STOP=1", "-qAt", "-c", query], {
    encoding: "utf8",
  }).trim();
}

const q = (value: string) => `'${value.replace(/'/g, "''")}'`;

export function ownerJson<T>(query: string): T {
  return JSON.parse(owner(`SELECT coalesce(json_agg(r), '[]') FROM (${query}) r`) || "[]") as T;
}

export const quietLogger = { error() {}, info() {} } as unknown as Logger;

export interface World {
  readonly clinicId: string;
  readonly otherClinicId: string;
  readonly roleId: string;
  readonly membershipId: string;
  readonly userId: string;
}

export interface ExportRow {
  status: string;
  attempt: number;
  lease_owner: string | null;
  lease_until: string | null;
  next_attempt_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  expires_at: string | null;
  storage_key: string | null;
  byte_size: number | null;
  row_count: number | null;
  error_code: string | null;
  patient_ids: string[] | null;
  scope: string;
  report: string;
  format: string;
  requested_by: string;
}

export interface BlobRow {
  id: string;
  attempt: number;
  state: string;
  storage_key: string;
}

export interface AuditRow {
  action: string;
  category: string;
  entity_type: string;
  entity_id: string;
  actor_user_id: string;
  branch_id: string | null;
  details: Record<string, unknown>;
}

function insertClinic(clinicId: string): string {
  const roleId = randomUUID();
  const slug = `fx-${clinicId.slice(0, 8)}`;
  owner(`INSERT INTO clinics (id, slug, name_ar, name_en, specialty, default_language, timezone, status,
           expires_at, max_users, max_branches, created_at, updated_at)
         VALUES (${q(clinicId)}, ${q(slug)}, 'Clinic', 'Clinic', 'general', 'en', 'Asia/Kuwait', 'active',
           clock_timestamp() + interval '30 days', 10, 3, clock_timestamp(), clock_timestamp());
         INSERT INTO roles (clinic_id, id, system_key, name_ar, name_en, is_locked, is_active, created_at, updated_at)
         VALUES (${q(clinicId)}, ${q(roleId)}, 'doctor', 'Doctor', 'Doctor', false, true, clock_timestamp(), clock_timestamp())`);
  return roleId;
}

export function seedWorld(): World {
  const clinicId = randomUUID();
  const otherClinicId = randomUUID();
  const roleId = insertClinic(clinicId);
  insertClinic(otherClinicId);
  const membershipId = randomUUID();
  const userId = randomUUID();
  const email = `member-${membershipId.slice(0, 8)}@example.test`;
  owner(`INSERT INTO email_reservations (email, kind, clinic_id, invitation_id, expires_at, reserved_at)
         VALUES (${q(email)}, 'membership', ${q(clinicId)}, null, null, clock_timestamp())`);
  owner(`INSERT INTO memberships (clinic_id, id, user_id, full_name, email, role_id, all_branches, status,
           preferred_language, last_login_at, created_at, updated_at)
         VALUES (${q(clinicId)}, ${q(membershipId)}, ${q(userId)}, 'Member', ${q(email)}, ${q(roleId)}, true,
           'active', 'en', null, clock_timestamp(), clock_timestamp())`);
  return { clinicId, otherClinicId, roleId, membershipId, userId };
}

export function seedMember(world: World): { membershipId: string; userId: string } {
  const membershipId = randomUUID();
  const userId = randomUUID();
  const email = `member-${membershipId.slice(0, 8)}@example.test`;
  owner(`INSERT INTO email_reservations (email, kind, clinic_id, invitation_id, expires_at, reserved_at)
         VALUES (${q(email)}, 'membership', ${q(world.clinicId)}, null, null, clock_timestamp())`);
  owner(`INSERT INTO memberships (clinic_id, id, user_id, full_name, email, role_id, all_branches, status,
           preferred_language, last_login_at, created_at, updated_at)
         VALUES (${q(world.clinicId)}, ${q(membershipId)}, ${q(userId)}, 'Member', ${q(email)}, ${q(world.roleId)},
           true, 'active', 'en', null, clock_timestamp(), clock_timestamp())`);
  return { membershipId, userId };
}

export function insertExport(
  world: World,
  options: {
    report?: string;
    format?: "csv" | "xlsx";
    scope?: "clinic" | "branch" | "own";
    requestedBy?: string;
    params?: string;
  } = {},
): string {
  const exportId = randomUUID();
  const report = options.report ?? "daily_takings";
  const format = options.format ?? "csv";
  const scope = options.scope ?? "clinic";
  const params =
    options.params ?? '{"from":"2026-01-01","to":"2026-01-31","language":"en","branchIds":[]}';
  owner(`INSERT INTO finance_report_exports (clinic_id, id, requested_by, report, params, format, scope, status,
           attempt, created_at)
         VALUES (${q(world.clinicId)}, ${q(exportId)}, ${q(options.requestedBy ?? world.membershipId)}, ${q(report)},
           ${q(params)}::jsonb, ${q(format)}, ${q(scope)}, 'queued', 0, clock_timestamp())`);
  return exportId;
}

export function markRunning(
  clinicId: string,
  exportId: string,
  options: { attempt: number; owner: string; lease: "live" | "expired"; startedAt?: string },
): void {
  const until = options.lease === "live" ? "interval '45 seconds'" : "interval '-1 second'";
  const started =
    options.startedAt === undefined ? "clock_timestamp()" : `${q(options.startedAt)}::timestamptz`;
  owner(`UPDATE finance_report_exports
            SET status = 'running', attempt = ${options.attempt}, lease_owner = ${q(options.owner)},
                lease_until = clock_timestamp() + ${until}, started_at = ${started}
          WHERE clinic_id = ${q(clinicId)} AND id = ${q(exportId)}`);
}

export function markTerminal(
  clinicId: string,
  exportId: string,
  status: "done" | "failed" | "expired" | "purged",
  errorCode: string | null = null,
): void {
  const code = errorCode === null ? "NULL" : q(errorCode);
  owner(`UPDATE finance_report_exports
            SET status = ${q(status)}, error_code = ${code}, lease_owner = NULL, lease_until = NULL
          WHERE clinic_id = ${q(clinicId)} AND id = ${q(exportId)}`);
}

export function setAttempt(
  clinicId: string,
  exportId: string,
  attempt: number,
  status = "queued",
): void {
  owner(`UPDATE finance_report_exports
            SET attempt = ${attempt}, status = ${q(status)}, lease_owner = NULL, lease_until = NULL,
                next_attempt_at = NULL
          WHERE clinic_id = ${q(clinicId)} AND id = ${q(exportId)}`);
}

export function setNextAttemptMinutes(clinicId: string, exportId: string, minutes: number): void {
  owner(`UPDATE finance_report_exports
            SET next_attempt_at = clock_timestamp() + interval '${minutes} minutes'
          WHERE clinic_id = ${q(clinicId)} AND id = ${q(exportId)}`);
}

export function insertBlob(
  clinicId: string,
  exportId: string,
  attempt: number,
  state: "allocated" | "uploaded" | "published" | "deleted" | "gone",
  extension: "csv" | "xlsx",
): string {
  const id = randomUUID();
  const key = `clinic/${clinicId}/finance-exports/${exportId}/${attempt}.${extension}`;
  const deleted = state === "deleted" || state === "gone" ? "clock_timestamp()" : "NULL";
  owner(`INSERT INTO finance_report_export_blobs (clinic_id, id, export_id, attempt, storage_key, state,
           deleted_at, created_at, updated_at)
         VALUES (${q(clinicId)}, ${q(id)}, ${q(exportId)}, ${attempt}, ${q(key)}, ${q(state)}, ${deleted},
           clock_timestamp(), clock_timestamp())`);
  return id;
}

export function readExport(clinicId: string, exportId: string): ExportRow | null {
  return (
    ownerJson<ExportRow[]>(
      `SELECT status, attempt, lease_owner, lease_until::text, next_attempt_at::text, started_at::text,
              finished_at::text, expires_at::text, storage_key, byte_size, row_count, error_code,
              to_jsonb(patient_ids) AS patient_ids, scope, report, format, requested_by
         FROM finance_report_exports WHERE clinic_id = ${q(clinicId)} AND id = ${q(exportId)}`,
    )[0] ?? null
  );
}

export function readBlobs(clinicId: string, exportId: string): BlobRow[] {
  return ownerJson<BlobRow[]>(
    `SELECT id, attempt, state, storage_key FROM finance_report_export_blobs
      WHERE clinic_id = ${q(clinicId)} AND export_id = ${q(exportId)} ORDER BY attempt`,
  );
}

export function readAudits(clinicId: string, exportId: string): AuditRow[] {
  return ownerJson<AuditRow[]>(
    `SELECT action, category, entity_type, entity_id, actor_user_id, branch_id, details
       FROM audit_log
      WHERE clinic_id = ${q(clinicId)} AND entity_type = 'finance_report_export' AND entity_id = ${q(exportId)}`,
  );
}

export function secondsFromDbNow(iso: string): number {
  return Number(owner(`SELECT extract(epoch FROM (${q(iso)}::timestamptz - clock_timestamp()))`));
}

export function seedExportEvent(
  clinicId: string,
  exportId: string,
  place: "before-ready" | "now" = "before-ready",
): string {
  const id = randomUUID();
  const created =
    place === "now"
      ? "clock_timestamp()"
      : `coalesce((SELECT min(created_at) - interval '1 second' FROM outbox_events
            WHERE event_type = 'finance.report_export_requested' AND dispatched_at IS NULL
              AND failed_at IS NULL
              AND (next_attempt_at IS NULL OR next_attempt_at <= clock_timestamp())), clock_timestamp())`;
  owner(`INSERT INTO outbox_events (id, clinic_id, event_type, payload, created_at)
         VALUES (${q(id)}, ${q(clinicId)}, 'finance.report_export_requested',
           ${q(JSON.stringify({ exportId }))}::jsonb, ${created})`);
  return id;
}

export interface EventRow {
  attempts: number;
  last_error: string | null;
  dispatched_at: string | null;
  failed_at: string | null;
  next_attempt_at: string | null;
}

export function readEvent(id: string): EventRow {
  return ownerJson<EventRow[]>(
    `SELECT attempts, last_error, dispatched_at::text, failed_at::text, next_attempt_at::text
       FROM outbox_events WHERE id = ${q(id)}`,
  )[0]!;
}
