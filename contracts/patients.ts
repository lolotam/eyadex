import { z } from "zod";
import { idSchema, pageQuerySchema } from "./common";

export const genderSchema = z.enum(["male", "female"]);
export type Gender = z.infer<typeof genderSchema>;

export const patientStatusSchema = z.enum(["active", "archived"]);
export type PatientStatus = z.infer<typeof patientStatusSchema>;

/**
 * Kuwait numbers: 8 digits, or +965 / 00965 followed by 8 digits. Spaces, dashes and
 * brackets are ignored. Returns the canonical "+965XXXXXXXX" form, or null when invalid.
 */
export function normalizeKuwaitPhone(raw: string): string | null {
  const compact = raw.replace(/[\s\-().]/g, "");
  const match = /^(?:\+965|00965)?(\d{8})$/.exec(compact);
  return match ? `+965${match[1]}` : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's calendar date (YYYY-MM-DD) in an IANA time zone. */
export function todayInTimeZone(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** A real calendar date on or before `today`. */
export function isBirthDateValid(value: string, today: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  return value <= today;
}

/**
 * The schema can't know the clinic, so it accepts any date that is already today somewhere
 * (UTC+14); the API then checks against today in the clinic's own time zone.
 */
function isPastOrToday(value: string): boolean {
  return isBirthDateValid(value, todayInTimeZone("Etc/GMT-14"));
}

/** Stored record (mock / database row). fileNumber is a per-clinic counter, never sent by clients. */
export const patientSchema = z.object({
  id: idSchema,
  clinicId: idSchema,
  fileNumber: z.number().int().positive(),
  fullName: z.string(),
  /** Canonical +965XXXXXXXX. */
  phone: z.string(),
  birthDate: z.string(),
  gender: genderSchema,
  registrationBranchId: idSchema,
  civilId: z.string().nullable(),
  status: patientStatusSchema,
  createdAt: z.string().datetime(),
});
export type Patient = z.infer<typeof patientSchema>;

/** Create and update share one input; the system assigns fileNumber. */
export const patientInputSchema = z.object({
  fullName: z.string().trim().min(1, "validation.required").max(120, "validation.tooLong"),
  phone: z
    .string()
    .trim()
    .min(1, "validation.required")
    .refine((v) => normalizeKuwaitPhone(v) !== null, "validation.phoneKw"),
  birthDate: z
    .string()
    .min(1, "validation.dateRequired")
    .refine(isPastOrToday, "validation.birthDate"),
  gender: genderSchema,
  registrationBranchId: idSchema,
  /** Empty string = none. */
  civilId: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{12}$/.test(v), "validation.civilId"),
});
export type PatientInput = z.infer<typeof patientInputSchema>;

export const patientListQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(100),
  branchId: idSchema.nullable(),
  status: patientStatusSchema.nullable(),
});
export type PatientListQuery = z.infer<typeof patientListQuerySchema>;

/** What the caller may do to this one record, under each action's own scope. */
export const patientRecordActionsSchema = z.object({
  update: z.boolean(),
  deactivate: z.boolean(),
});
export type PatientRecordActions = z.infer<typeof patientRecordActionsSchema>;

/** List rows never carry the full civil ID, only its last 4 digits. */
export const patientListItemSchema = z.object({
  id: idSchema,
  fileNumber: z.number().int().positive(),
  fullName: z.string(),
  phone: z.string(),
  registrationBranchId: idSchema,
  branchNameAr: z.string(),
  branchNameEn: z.string(),
  civilIdLast4: z.string().nullable(),
  status: patientStatusSchema,
  actions: patientRecordActionsSchema,
});
export type PatientListItem = z.infer<typeof patientListItemSchema>;

export const patientDetailSchema = patientSchema.omit({ clinicId: true }).extend({
  branchNameAr: z.string(),
  branchNameEn: z.string(),
  actions: patientRecordActionsSchema,
});
export type PatientDetail = z.infer<typeof patientDetailSchema>;

/** The patients action whose scope decides which branches are offered. */
export const patientBranchActionSchema = z.enum(["view", "create", "update"]);
export type PatientBranchAction = z.infer<typeof patientBranchActionSchema>;

/** Branches the caller may file patients under (or filter by), within their scope. */
export const patientBranchOptionSchema = z.object({
  id: idSchema,
  nameAr: z.string(),
  nameEn: z.string(),
  isActive: z.boolean(),
});
export type PatientBranchOption = z.infer<typeof patientBranchOptionSchema>;

/** Display form of a file number, e.g. 123 -> "000123". */
export function formatFileNumber(n: number): string {
  return String(n).padStart(6, "0");
}
