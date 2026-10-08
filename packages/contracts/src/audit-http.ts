import { z } from "zod";
import {
  auditCategorySchema,
  clinicAuditItemSchema,
  platformAuditClinicOptionSchema,
  platformAuditEntitySchema,
  platformAuditItemSchema,
  platformAuditSourceSchema,
} from "./audit.ts";
import { idSchema } from "./common.ts";
import { clinicAuditEntitySchema } from "./organization.ts";

/**
 * The audit HTTP API (Phase B slice 10, ADR-0019). `audit.ts` keeps the web's shapes; these are the
 * query strings and the strict answers of `/v1/clinic/audit` and `/v1/platform/audit`.
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const daysIn = (year: number, month: number) =>
  month === 2
    ? (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
      ? 29
      : 28
    : [4, 6, 9, 11].includes(month)
      ? 30
      : 31;

/**
 * A real calendar day PostgreSQL can hold (years 1–9999), checked on the text itself: "2026-02-31",
 * "2026-13-01" or year 0 would otherwise reach the database as an invalid date (a 500). No `Date` is
 * built, so nothing can throw.
 *
 * @param value the text, `YYYY-MM-DD`
 * @returns whether it names one real day
 */
export function isCalendarDay(value: string): boolean {
  const match = DAY.exec(value);
  if (match === null) return false;
  const [year, month, dayOfMonth] = match.slice(1).map(Number) as [number, number, number];
  return (
    year >= 1 && month >= 1 && month <= 12 && dayOfMonth >= 1 && dayOfMonth <= daysIn(year, month)
  );
}

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isCalendarDay, { message: "invalid_date" });

const filters = {
  cursor: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,256}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Case-insensitive part of the actor's shown name. */
  actor: z.string().trim().min(1).max(100).optional(),
  action: z.string().trim().min(1).max(60).optional(),
  /** Calendar days in the clinic's time zone (the platform list: Asia/Kuwait). */
  from: day.optional(),
  to: day.optional(),
};

export const clinicAuditQuerySchema = z
  .object({
    ...filters,
    entity: clinicAuditEntitySchema.optional(),
    category: auditCategorySchema.optional(),
  })
  .strict();
export type ClinicAuditQuery = z.infer<typeof clinicAuditQuerySchema>;

export const platformAuditQuerySchema = z
  .object({
    ...filters,
    entity: platformAuditEntitySchema.optional(),
    source: platformAuditSourceSchema.optional(),
    clinicId: idSchema.optional(),
  })
  .strict();
export type PlatformAuditQuery = z.infer<typeof platformAuditQuerySchema>;

const page = <T extends z.ZodTypeAny>(item: T) =>
  z
    .object({
      items: z.array(item),
      nextCursor: z.string().nullable(),
      /** Every entry matching the filters, counted on its own statement (not off the page). */
      total: z.number().int().nonnegative(),
    })
    .strict();

export const clinicAuditListResponseSchema = page(clinicAuditItemSchema.strict());
export type ClinicAuditListResponse = z.infer<typeof clinicAuditListResponseSchema>;

export const platformAuditListResponseSchema = page(platformAuditItemSchema.strict());
export type PlatformAuditListResponse = z.infer<typeof platformAuditListResponseSchema>;

export const platformAuditClinicOptionsResponseSchema = z.array(
  platformAuditClinicOptionSchema.strict(),
);
export type PlatformAuditClinicOptionsResponse = z.infer<
  typeof platformAuditClinicOptionsResponseSchema
>;
