import { z } from "zod";
import { legacyNumber } from "./number-compat.ts";
import { legacyInteger } from "./integer-compat.ts";
import { utcDatetime } from "./datetime-compat.ts";
import { messageLanguageSchema } from "./notifications.ts";
import { idSchema, pageQuerySchema, stripInvisibleControls } from "./common.ts";

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

export { stripInvisibleControls } from "./common.ts";

/** Free text a person types (a name, a search term): invisible controls dropped first, then trimmed. */
const visibleText = () => z.string().transform(stripInvisibleControls);

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

/** Century digit of a Kuwaiti civil ID: 2 = 19YY, 3 = 20YY. Any other digit is not a real ID. */
const CIVIL_ID_CENTURIES: Record<string, number> = { "2": 1900, "3": 2000 };
const CIVIL_ID_WEIGHTS = [2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2] as const;
const ASCII_ZERO = 0x30;

/**
 * Arabic-Indic (٠-٩) and Eastern Arabic-Indic / Persian (۰-۹) digits become ASCII, and spaces and
 * dashes are dropped, because Kuwaiti keyboards and pasted forms mix all three with ASCII.
 * Only the shape is normalized here; `isValidKuwaitCivilId` decides whether the number is real.
 */
export function normalizeCivilId(raw: string): string {
  return raw
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\s-]/g, "");
}

/**
 * The digits of a search term, as ASCII: full-width digits are folded by NFKC and Arabic-Indic /
 * Eastern Arabic-Indic digits by `normalizeCivilId`, so a phone, file number or civil ID typed on an
 * Arabic or Persian keyboard still finds the file.
 */
export function searchDigits(term: string): string {
  return normalizeCivilId(term.normalize("NFKC")).replace(/\D/g, "");
}

/** A real calendar day, so 30 February and 29 February in a common year are both refused. */
function isRealCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** The checksum digit over the first 11 digits of an already shape-checked id. 10 means "no digit". */
function civilIdChecksumDigit(id: string): number {
  const sum = CIVIL_ID_WEIGHTS.reduce(
    (total, weight, i) => total + (id.charCodeAt(i) - ASCII_ZERO) * weight,
    0,
  );
  return 11 - (sum % 11);
}

/**
 * A Kuwaiti civil ID is 12 ASCII digits: a century digit, YYMMDD as a real birth date, four
 * serial digits and a checksum digit. `id` must already be normalized by `normalizeCivilId`.
 */
export function isValidKuwaitCivilId(id: string): boolean {
  if (!/^\d{12}$/.test(id)) return false;
  const century = CIVIL_ID_CENTURIES[id.charAt(0)];
  if (century === undefined) return false;
  const year = century + Number(id.slice(1, 3));
  const month = Number(id.slice(3, 5));
  const day = Number(id.slice(5, 7));
  if (!isRealCalendarDate(year, month, day)) return false;
  const check = civilIdChecksumDigit(id);
  return check <= 9 && check === Number(id.slice(11));
}

/** The birth date the id encodes, as YYYY-MM-DD, or null when the id is not a valid one. */
export function civilIdBirthDate(id: string): string | null {
  if (!isValidKuwaitCivilId(id)) return null;
  const year = (CIVIL_ID_CENTURIES[id.charAt(0)] ?? 0) + Number(id.slice(1, 3));
  return `${year}-${id.slice(3, 5)}-${id.slice(5, 7)}`;
}

/** Stored record (mock / database row). fileNumber is a per-clinic counter, never sent by clients. */
export const patientSchema = z.object({
  id: idSchema,
  clinicId: idSchema,
  fileNumber: legacyNumber().check(legacyInteger()).check(z.positive()),
  fullName: z.string(),
  /** Canonical +965XXXXXXXX. */
  phone: z.string(),
  birthDate: z.string(),
  gender: genderSchema,
  registrationBranchId: idSchema,
  civilId: z.string().nullable(),
  /** Where the patient's messages go (phase 3); `null` = none recorded. */
  email: z.string().nullable(),
  /** `null` = the clinic's default language. */
  messageLanguage: messageLanguageSchema.nullable(),
  /** The patient asked for no reminders; other messages still go out (N-2). */
  notificationsOptOut: z.boolean(),
  status: patientStatusSchema,
  createdAt: utcDatetime(),
});
export type Patient = z.infer<typeof patientSchema>;

/** Empty means "not recorded"; anything else is normalized and must be a real Kuwaiti civil ID. */
const civilIdInput = z
  .string()
  .trim()
  .transform(normalizeCivilId)
  .refine((v) => v === "" || isValidKuwaitCivilId(v), "validation.civilId");

/** Create and update share one input; the system assigns fileNumber. */
export const patientInputSchema = z
  .object({
    fullName: visibleText().pipe(
      z.string().trim().min(1, "validation.required").max(120, "validation.tooLong"),
    ),
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
    civilId: civilIdInput,
    /** Empty string = none. */
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254, "validation.tooLong")
      .refine((v) => v === "" || z.string().email().safeParse(v).success, "validation.email"),
    /** Empty string = the clinic's default language. */
    messageLanguage: z.union([z.literal(""), messageLanguageSchema]),
    notificationsOptOut: z.boolean(),
  })
  .superRefine((value, ctx) => {
    // Digits 1-7 of a civil ID are its birth date, so a number and a date cannot disagree.
    if (!value.birthDate) return;
    const encoded = value.civilId ? civilIdBirthDate(value.civilId) : null;
    if (encoded === null || encoded === value.birthDate) return;
    ctx.addIssue({ code: "custom", path: ["civilId"], message: "validation.civilIdBirthDate" });
  });
export type PatientInput = z.infer<typeof patientInputSchema>;

export const patientListQuerySchema = pageQuerySchema.extend({
  q: visibleText().pipe(z.string().trim().max(100)),
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
  fileNumber: legacyNumber().check(legacyInteger()).check(z.positive()),
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

/**
 * What a write returns. The full file comes back only when the caller may open it right now;
 * a write can move a file out of the caller's view (or the caller may hold no view at all).
 */
export const patientWriteResultSchema = z.object({
  id: idSchema,
  fileNumber: legacyNumber().check(legacyInteger()).check(z.positive()),
  detail: patientDetailSchema.nullable(),
});
export type PatientWriteResult = z.infer<typeof patientWriteResultSchema>;
