import { z } from "zod";
import { stripInvisibleControls } from "./common.ts";

const section = z
  .string()
  .transform(stripInvisibleControls)
  .pipe(z.string().trim().max(4000, "validation.tooLong"))
  .nullable();

/** P2-7: the five sections, each free text; `PUT /v1/patients/:id/medical-profile` replaces all five. */
export const medicalProfileInputSchema = z
  .object({
    allergies: section,
    chronicConditions: section,
    currentMedications: section,
    surgicalHistory: section,
    familyHistory: section,
  })
  .strict();
export type MedicalProfileInput = z.infer<typeof medicalProfileInputSchema>;
export const medicalProfileSchema = z
  .object({
    profile: z
      .object({
        allergies: z.string().nullable(),
        chronicConditions: z.string().nullable(),
        currentMedications: z.string().nullable(),
        surgicalHistory: z.string().nullable(),
        familyHistory: z.string().nullable(),
      })
      .strict(),
    updatedAt: z.string().datetime().nullable(),
    updatedByName: z.string().nullable(),
    can: z.object({ update: z.boolean() }).strict(),
  })
  .strict();
export type MedicalProfile = z.infer<typeof medicalProfileSchema>;
