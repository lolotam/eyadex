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

// A real calendar day: "2026-02-31" would otherwise reach the database as an invalid date (a 500).
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), {
    message: "invalid_date",
  });

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
