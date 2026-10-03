import { z } from "zod";
import { idSchema } from "./common";
import { clinicStatusSchema, featuresSchema } from "./clinics";

export const personaKindSchema = z.enum([
  "platform_admin",
  "clinic_admin",
  "doctor",
  "receptionist",
  "technician",
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
    })
    .nullable(),
  permissions: z.array(z.string()),
  features: featuresSchema,
  blocked: z.enum(["suspended", "expired"]).nullable(),
});
export type SessionContext = z.infer<typeof sessionContextSchema>;

export const platformAuditEntrySchema = z.object({
  id: idSchema,
  actorName: z.string(),
  action: z.string(),
  clinicId: idSchema.nullable(),
  summary: z.string(),
  createdAt: z.string().datetime(),
});
export type PlatformAuditEntry = z.infer<typeof platformAuditEntrySchema>;
