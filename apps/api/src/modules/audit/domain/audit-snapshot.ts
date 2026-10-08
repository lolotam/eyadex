import type { PlatformAuditEntity } from "@eyadex/contracts/audit";
import type { clinicAuditEntitySchema } from "@eyadex/contracts/organization";
import { maskPhone, maskPhonesInText, redactSecrets } from "@eyadex/observability";
import type { z } from "zod";

/** كل كيان ممكن يظهر في أي من السجلين. */
export type AuditEntity = z.infer<typeof clinicAuditEntitySchema> | PlatformAuditEntity;

type Snapshot = Record<string, unknown>;

const PERSON = [
  "fullName",
  "email",
  "roleId",
  "roleNameAr",
  "roleNameEn",
  "allBranches",
  "branchIds",
  "status",
  "expiresAt",
  "invitationId",
] as const;

// PRD §4.11: before/after is an allowlist. These are the fields the writers record today (branch,
// person, invitation, mail-provider and platform snapshots); a key not listed here is never shown,
// whatever a writer stores. No token, hash, password, credential or civil ID is on any list.
const ALLOWED: Record<AuditEntity, readonly string[]> = {
  branch: ["nameAr", "nameEn", "address", "phone", "isActive"],
  user: PERSON,
  invitation: PERSON,
  role: ["nameAr", "nameEn", "isActive", "permissionKeys"],
  clinic_mail_provider: [
    "kind",
    "fromName",
    "fromEmail",
    "replyTo",
    "smtpHost",
    "smtpPort",
    "smtpUser",
    "hasCredentials",
    "verifiedAt",
    "lastError",
    "degradedAt",
  ],
  clinic: [
    "slug",
    "nameAr",
    "nameEn",
    "specialty",
    "status",
    "expiresAt",
    "maxUsers",
    "maxBranches",
    "modules",
    "module",
    "enabled",
    "firstAdmin",
  ],
  // TODO(spec): the patients slice defines what a patient-file entry may show; until then nothing.
  patient: [],
  // No writer yet (platform team and settings slices): nothing until they define their fields.
  platform_account: [],
  platform_settings: [],
};

// Free text a person typed can hold a phone number; the writers mask it, the reader masks again.
const FREE_TEXT = new Set([
  "nameAr",
  "nameEn",
  "address",
  "fullName",
  "roleNameAr",
  "roleNameEn",
  "fromName",
  "fromEmail",
  "replyTo",
  "smtpHost",
  "smtpUser",
]);

// Context a writer keeps beside before/after that the reader needs to make sense of the change
// (a feature change records which module); copied into each non-null snapshot.
const CONTEXT_KEYS = ["module"] as const;

const isPlainObject = (value: unknown): value is Snapshot =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function masked(key: string, value: unknown): unknown {
  if (key === "phone") return value === null ? null : maskPhone(value);
  return FREE_TEXT.has(key) && typeof value === "string" ? maskPhonesInText(value) : value;
}

function project(entity: AuditEntity, side: unknown, context: Snapshot): Snapshot | null {
  if (!isPlainObject(side)) return null;
  const allowed = new Set(ALLOWED[entity]);
  const out: Snapshot = {};
  for (const [key, value] of Object.entries({ ...side, ...context })) {
    if (allowed.has(key)) out[key] = masked(key, value);
  }
  if (Object.keys(out).length === 0) return null;
  // Defence in depth over the allowlist: a secret, PEM or civil ID typed into an allowed field.
  return redactSecrets(out) as Snapshot;
}

/**
 * لقطتين قبل/بعد اللي بيظهروا في السجل: من `details.before` و`details.after` بس، بالحقول المسموحة
 * للكيان ده، والسرّي (توكن، باسورد، رقم مدني) بيتشال، والتليفونات بآخر 3 أرقام.
 *
 * @param entity الكيان زي ما بيظهر في العقد
 * @param details عمود `details` زي ما اتخزن
 * @returns اللقطتين؛ `null` لما مفيش لقطة أو مفيش ولا حقل مسموح
 */
export function auditSnapshots(
  entity: AuditEntity,
  details: unknown,
): { before: Snapshot | null; after: Snapshot | null } {
  if (!isPlainObject(details)) return { before: null, after: null };
  const context: Snapshot = {};
  for (const key of CONTEXT_KEYS) if (key in details) context[key] = details[key];
  return {
    before: project(entity, details["before"], context),
    after: project(entity, details["after"], context),
  };
}
