import { z } from "zod";
import { idSchema } from "./common";

export const genderSchema = z.enum(["male", "female"]);

export const patientSchema = z.object({
  id: idSchema,
  clinicId: idSchema,
  fileNumber: z.string(),
  fullName: z.string(),
  phone: z.string(),
  birthDate: z.string(),
  gender: genderSchema,
  registrationBranchId: idSchema,
  civilId: z.string().nullable(),
  status: z.enum(["active", "archived"]),
  createdAt: z.string().datetime(),
});
export type Patient = z.infer<typeof patientSchema>;
