import { z } from "zod";
import { idSchema } from "./common.ts";

export const ATTACHMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const attachmentTypeSchema = z.enum(ATTACHMENT_TYPES);

/** P2-10: an encrypted file of a patient, optionally on a visit; archived, never deleted. */
export const attachmentSchema = z
  .object({
    id: idSchema,
    patientId: idSchema,
    visitId: idSchema.nullable(),
    name: z.string(),
    contentType: attachmentTypeSchema,
    sizeBytes: z.number().int().positive(),
    status: z.enum(["active", "archived"]),
    uploadedAt: z.string().datetime(),
    uploadedByName: z.string(),
  })
  .strict();
export type Attachment = z.infer<typeof attachmentSchema>;
export const attachmentListSchema = z.object({ items: z.array(attachmentSchema) }).strict();
export const attachmentListQuerySchema = z.object({ visitId: idSchema.optional() }).strict();
