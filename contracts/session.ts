import { z } from "zod";
import { idSchema } from "./common";
import { clinicStatusSchema, featuresSchema } from "./clinics";

export const personaKindSchema = z.enum([
  "platform_admin",
  "clinic_admin",
  "doctor",
  "receptionist",
  "technician",
  /** Any account holding a clinic-created role; always pinned to an exact memberId. */
  "custom",
]);
export type PersonaKind = z.infer<typeof personaKindSchema>;

export const personaSchema = z.object({
  kind: personaKindSchema,
  clinicId: idSchema.nullable(),
  /** The exact clinic account signed in; null = first active account holding this persona's role. */
  memberId: idSchema.nullable().default(null),
});
export type Persona = z.infer<typeof personaSchema>;

export const loginClinicSchema = z.object({
  id: idSchema,
  nameAr: z.string(),
  nameEn: z.string(),
});
export type LoginClinic = z.infer<typeof loginClinicSchema>;

export const sessionContextSchema = z.object({
  persona: personaSchema,
  user: z.object({ fullName: z.string(), email: z.string() }),
  clinic: z
    .object({
      id: idSchema,
      nameAr: z.string(),
      nameEn: z.string(),
      status: clinicStatusSchema,
      expiresAt: z.string(),
      /** IANA zone; timestamps are shown in the clinic's time, not the browser's. */
      timezone: z.string(),
    })
    .nullable(),
  permissions: z.array(z.string()),
  features: featuresSchema,
  blocked: z.enum(["suspended", "expired"]).nullable(),
  /** Days left when the expiry is within the platform alert window; null = no banner. */
  expiresInDays: z.number().int().nullable(),
});
export type SessionContext = z.infer<typeof sessionContextSchema>;

export const platformAuditEntrySchema = z.object({
  id: idSchema,
  actorName: z.string(),
  action: z.string(),
  clinicId: idSchema.nullable(),
  /** The record the event is about when it is not the clinic (e.g. a platform account). */
  entityId: idSchema.nullable().optional(),
  /** Internal English note for operators; never shown in the UI (not localizable). */
  summary: z.string(),
  /** Allowlisted values before/after the change, rendered field by field and translated. */
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string().datetime(),
});
export type PlatformAuditEntry = z.infer<typeof platformAuditEntrySchema>;
