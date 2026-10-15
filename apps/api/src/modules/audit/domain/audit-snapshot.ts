import type { PlatformAuditEntity } from "@eyadex/contracts/audit";
import type { clinicAuditEntitySchema } from "@eyadex/contracts/organization";
import { maskPhone, normalizeAuditText, scrubAuditValue } from "@eyadex/observability";
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
  "preferredLanguage",
  "acceptsAppointments",
  "defaultDurationMinutes",
] as const;

const FIELD_NAMES_ONLY = ["changed"] as const;

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
    "slot",
  ],
  // ADR-0026: the appointments module's configuration. A time-off note is free text about a person's
  // absence: it is never recorded, so it can never be shown.
  clinic_service: ["nameAr", "nameEn", "durationMinutes", "status"],
  provider_schedule: ["providerName", "branchId", "shifts"],
  provider_time_off: ["providerName", "startsAt", "endsAt", "cancelled"],
  // ADR-0026 §11 (A2): a booking's administrative facts only. The patient (name, phone, id) and the
  // free-text cancel note are never shown, whatever a writer stores.
  appointment: [
    "providerName",
    "branchId",
    "serviceNameAr",
    "serviceNameEn",
    "startsAt",
    "endsAt",
    "status",
    "overbooked",
    "cancelReason",
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
    "defaultLanguage",
    "timezone",
    // ADR-0031: the clinic's notification settings (switches only, no address).
    "emailEnabled",
    "messages",
  ],
  // TODO(spec): the patients slice defines what a patient-file entry may show; until then nothing.
  patient: [],
  // P2 R1-17, R3-4: the medical writers record which fields changed (`changed: ["plan"]`), never a
  // value, so a clinical text cannot reach the log whatever else a writer stores.
  visit: FIELD_NAMES_ONLY,
  visit_addendum: FIELD_NAMES_ONLY,
  diagnosis: FIELD_NAMES_ONLY,
  prescription: FIELD_NAMES_ONLY,
  medical_profile: FIELD_NAMES_ONLY,
  attachment: FIELD_NAMES_ONLY,
  medicine: FIELD_NAMES_ONLY,
  // Finance F1: shared/finance-audit.ts writes these fields only, each checked against its shape (an
  // invoice number, minor-unit amounts, counts, discount kinds); a link open has no snapshot.
  invoice: [
    "number",
    "status",
    "version",
    "subtotalMinor",
    "discountMinor",
    "taxMinor",
    "totalMinor",
    "lineCount",
    "discounts",
  ],
  invoice_link: [],
  // ADR-0020: the platform team and settings writers. No link, hash or user id is ever recorded.
  platform_account: ["fullName", "email", "status"],
  platform_settings: [
    "defaultTrialDays",
    "alertDaysBeforeExpiry",
    "emailSenderName",
    "defaultMaxUsers",
    "defaultMaxBranches",
    "defaultModules",
  ],
};

// Context a writer keeps beside before/after that the reader needs to make sense of the change
// (a feature change records which module); copied into each non-null snapshot.
// A mail provider change records its slot (ADR-0031).
const CONTEXT_KEYS = ["module", "slot"] as const;

const isPlainObject = (value: unknown): value is Snapshot =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function project(entity: AuditEntity, side: unknown, context: Snapshot): Snapshot | null {
  if (!isPlainObject(side)) return null;
  const allowed = new Set(ALLOWED[entity]);
  const out: Snapshot = {};
  for (const [key, value] of Object.entries({ ...side, ...context })) {
    if (!allowed.has(key)) continue;
    // A phone field keeps 3 digits even when it is shorter than a phone-looking run.
    out[key] =
      key === "phone" && value !== null
        ? maskPhone(typeof value === "string" ? normalizeAuditText(value) : value)
        : value;
  }
  if (Object.keys(out).length === 0) return null;
  // An invoice snapshot is shape-checked when it is written (shared/finance-audit.ts); the scrub below
  // would read a 7-digit amount as a phone number and mask it.
  if (entity === "invoice") return out;
  // Defence in depth over the allowlist, at every depth (`firstAdmin.email` is nested): a secret, PEM
  // or civil ID typed into an allowed field, and a phone number written anywhere — an email's local
  // part included.
  return scrubAuditValue(out) as Snapshot;
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
