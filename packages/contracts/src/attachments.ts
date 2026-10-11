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
/**
 * The list carries the caller's own write rule for the file, as the API decides it: `archive` = the
 * update reach covers the file (`own` = one of the caller's patients), `upload` = that and an active
 * file. A visit's upload is the visit detail's `can.attach`, not this.
 */
export const attachmentListSchema = z
  .object({
    items: z.array(attachmentSchema),
    can: z.object({ upload: z.boolean(), archive: z.boolean() }).strict(),
  })
  .strict();
export type AttachmentList = z.infer<typeof attachmentListSchema>;
/** `POST /v1/patients/:id/attachments` and `POST /v1/attachments/:id/archive` answer the attachment. */
export const attachmentWriteResponseSchema = z.object({ attachment: attachmentSchema }).strict();
export type AttachmentWriteResponse = z.infer<typeof attachmentWriteResponseSchema>;
export const attachmentListQuerySchema = z.object({ visitId: idSchema.optional() }).strict();
