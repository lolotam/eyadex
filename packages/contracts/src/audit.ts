import { z } from "zod";
import { idSchema, pageQuerySchema } from "./common.ts";
import { clinicAuditEntitySchema } from "./organization.ts";

/** فاعل إجراء تلقائي ينفّذه Eyadex، ولا يمثل شخصًا أو حساب مستخدم. */
export const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.dateRequired");

export const auditCategorySchema = z.enum(["patient_access", "administrative"]);
export type AuditCategory = z.infer<typeof auditCategorySchema>;

const snapshotSchema = z.record(z.string(), z.unknown()).nullable();

/** Shared filters. Dates are calendar days in the clinic time zone (Asia/Kuwait on the platform). */
const auditFilters = {
  actor: z.string().trim().max(100),
  action: z.string().trim().max(60).nullable(),
  from: isoDate.nullable(),
  to: isoDate.nullable(),
};

export const clinicAuditListQuerySchema = pageQuerySchema.extend({
  ...auditFilters,
  entity: clinicAuditEntitySchema.nullable(),
  category: auditCategorySchema.nullable(),
});
export type ClinicAuditListQuery = z.infer<typeof clinicAuditListQuerySchema>;

export const clinicAuditItemSchema = z.object({
  id: idSchema,
  at: z.string().datetime(),
  actorName: z.string(),
  action: z.string(),
  entity: clinicAuditEntitySchema,
  category: auditCategorySchema,
  entityId: idSchema.nullable(),
  before: snapshotSchema,
  after: snapshotSchema,
});
export type ClinicAuditItem = z.infer<typeof clinicAuditItemSchema>;

/** Entities the platform may ever see: "patient" is not in this list by construction. */
export const platformAuditEntitySchema = z.enum([
  "clinic",
  "branch",
  "user",
  "invitation",
  "role",
  "platform_account",
  "platform_settings",
  "clinic_mail_provider",
]);
export type PlatformAuditEntity = z.infer<typeof platformAuditEntitySchema>;

export const platformAuditSourceSchema = z.enum(["platform", "clinic"]);

export const platformAuditListQuerySchema = pageQuerySchema.extend({
  ...auditFilters,
  entity: platformAuditEntitySchema.nullable(),
  source: platformAuditSourceSchema.nullable(),
  /** One clinic's events only (PRD story 22); null = every clinic. */
  clinicId: idSchema.nullable(),
});
export type PlatformAuditListQuery = z.infer<typeof platformAuditListQuerySchema>;

export const platformAuditItemSchema = z.object({
  id: idSchema,
  at: z.string().datetime(),
  actorName: z.string(),
  action: z.string(),
  source: platformAuditSourceSchema,
  entity: platformAuditEntitySchema,
  /** Platform events and clinic entries alike are administrative; patient access never appears. */
  category: z.literal("administrative"),
  entityId: idSchema.nullable(),
  clinicId: idSchema.nullable(),
  clinicNameAr: z.string().nullable(),
  clinicNameEn: z.string().nullable(),
  before: snapshotSchema,
  after: snapshotSchema,
});
export type PlatformAuditItem = z.infer<typeof platformAuditItemSchema>;

export const PLATFORM_AUDIT_TIME_ZONE = "Asia/Kuwait";

/** Calendar day (YYYY-MM-DD) of an instant in a time zone. */
export function dayInTimeZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** Actions written to a clinic's own log (the clinic audit screen). */
export const CLINIC_AUDIT_ACTIONS = [
  "branch.created",
  "branch.updated",
  "branch.deactivated",
  "branch.reactivated",
  "user.created",
  "user.role_changed",
  "user.branches_changed",
  "user.deactivated",
  "user.reactivated",
  "user.profile_updated",
  "user.booking_changed",
  "invitation.sent",
  "invitation.resent",
  "invitation.link_copied",
  "invitation.cancelled",
  "invitation.auto_cancelled",
  "invitation.accepted",
  "role.created",
  "role.updated",
  "role.deactivated",
  "role.reactivated",
  "patient.opened",
  "patient.created",
  "patient.updated",
  "patient.archived",
  "patient.restored",
  // Phase 3 N1: the worker writes it when a prescription email goes out (no medicine names).
  "patient.prescription_sent",
  "clinic.settings_updated",
  "clinic.mail_provider_updated",
  "clinic.mail_provider_removed",
  "clinic.mail_provider_test_requested",
  "clinic.mail_provider_degraded",
  "clinic.notification_settings_updated",
  // Phase 3 N2 (spec §7.1): the WhatsApp channel. No token and no number in their details.
  "clinic.whatsapp_risk_accepted",
  "clinic.whatsapp_connected",
  "clinic.whatsapp_disconnected",
  "clinic.whatsapp_coexistence_updated",
  "service.created",
  "service.updated",
  "service.deactivated",
  "service.reactivated",
  "schedule.replaced",
  "time_off.added",
  "time_off.cancelled",
  "appointment.booked",
  "appointment.rescheduled",
  "appointment.status_changed",
  "appointment.cancelled",
  // P2 (R3-4): snapshots hold field names only, never clinical values.
  "visit.started",
  "visit.opened",
  "visit.note_saved",
  "visit.signed",
  "visit.cancelled",
  "visit.addendum_added",
  "visit.diagnoses_saved",
  "visit.prescription_saved",
  "visit.prescription_printed",
  "visit.searched",
  "visit.walk_in_searched",
  "visit.previews_listed",
  "medical_profile.opened",
  "medical_profile.saved",
  "attachment.uploaded",
  "attachment.downloaded",
  "attachment.archived",
  "attachment.listed",
  "medicine.created",
  "medicine.updated",
  "medicine.deactivated",
  "medicine.reactivated",
  // Finance F1: prices, the clinic's finance details and branch prefixes, and the invoices.
  "service.price_set",
  "service.provider_prices_set",
  "clinic.commercial_reg_no_set",
  "clinic.logo_set",
  "branch.invoice_prefix_set",
  "invoice.issued",
  "invoice.edited",
  "invoice.voided",
  "invoice.pdf_opened",
  "invoice.link_opened",
] as const;

/** Actions only the platform writes (its own log). */
export const PLATFORM_ONLY_AUDIT_ACTIONS = [
  "clinic.created",
  "clinic.details_updated",
  "clinic.subscription_updated",
  "clinic.feature_toggled",
  "clinic.feature_changed",
  "clinic.subscription_changed",
  "clinic.limits_changed",
  "platform_account.invited",
  "platform_account.deactivated",
  "platform_account.reactivated",
  "platform_account.joined",
  "platform_account.bootstrapped",
  "platform.settings_updated",
  // Finance F1: the clinic's currency and tax rate, set by the platform team.
  "clinic.finance_changed",
] as const;

/**
 * Clinic-log actions the platform never reads: patient access, the appointments module's
 * configuration (services, schedules, staff time off) — ADR-0026 §8 — the appointments, which name
 * patients (0043 keeps their rows out of the platform's view as well), and the medical module's
 * visits, medical files, attachments and medicines list (P2 R3-4), and the invoices (finance F1, 0060).
 */
const CLINIC_ONLY_ACTION =
  /^(patient|service|schedule|time_off|appointment|visit|medical_profile|attachment|medicine|invoice)\./;

/** What the platform audit screen can show: its own events plus clinic administrative ones. */
export const PLATFORM_AUDIT_ACTIONS = [
  ...PLATFORM_ONLY_AUDIT_ACTIONS,
  ...CLINIC_AUDIT_ACTIONS.filter((a) => !CLINIC_ONLY_ACTION.test(a)),
].filter((a, i, all) => all.indexOf(a) === i);

/** Every action the audit writers record, for labels. */
export const AUDIT_ACTIONS = [...CLINIC_AUDIT_ACTIONS, ...PLATFORM_ONLY_AUDIT_ACTIONS] as const;

/** Every clinic, by name, for the platform audit filter (no paging cap). */
export const platformAuditClinicOptionSchema = z.object({
  id: idSchema,
  nameAr: z.string(),
  nameEn: z.string(),
});
export type PlatformAuditClinicOption = z.infer<typeof platformAuditClinicOptionSchema>;
