import { z } from "zod";
import { idSchema, stripInvisibleControls } from "./common.ts";

const text = (max: number) =>
  z
    .string()
    .transform(stripInvisibleControls)
    .pipe(z.string().trim().max(max, "validation.tooLong"));

/** P2-F2: the clinic's frequent medicines (not patient data, stored plain). */
export const medicineInputSchema = z
  .object({
    name: text(120).pipe(z.string().min(1, "validation.required")),
    defaultDose: text(100).nullable(),
    defaultFrequency: text(100).nullable(),
  })
  .strict();
export type MedicineInput = z.infer<typeof medicineInputSchema>;
export const medicineSchema = medicineInputSchema.extend({
  id: idSchema,
  status: z.enum(["active", "inactive"]),
});
export type Medicine = z.infer<typeof medicineSchema>;
export const medicineListSchema = z.object({ items: z.array(medicineSchema) }).strict();
/** Every medicines write (`POST`, `PUT`, deactivate, reactivate) answers the row as saved (R3-3). */
export const medicineWriteResponseSchema = z.object({ medicine: medicineSchema }).strict();
