import multipart from "@fastify/multipart";
import { ATTACHMENT_MAX_BYTES } from "@eyadex/contracts/attachments";
import { idSchema } from "@eyadex/contracts/common";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { ApiError } from "../../../shared/errors.ts";
import type { UploadedFile } from "../use-cases/attachments/attachments.ts";

/** The one route that reads `multipart/form-data` (R1-14). */
const UPLOAD_ROUTE = "/v1/patients/:id/attachments";

// R2-7: one file part and one optional field (a visit id, 36 characters). Busboy enforces these while it
// parses; a file over the size is truncated (not thrown), so the route answers `attachment_too_large`.
const LIMITS = { fileSize: ATTACHMENT_MAX_BYTES, files: 1, fields: 1, parts: 2, fieldSize: 36 };

// The path names the expected field, never the client's own part name.
const malformed = (field: "file" | "visitId") =>
  new ApiError("validation", [{ path: [field], code: "invalid" }]);

// The status Fastify gives a body type a route does not parse; the envelope filter answers `validation`.
class UnsupportedMediaType extends Error {
  readonly statusCode = 415;
}

/**
 * Teaches Fastify `multipart/form-data` for the attachment upload only. A content-type parser is
 * instance-wide in Fastify (Nest registers every route on the root instance), so the parser is
 * registered once and a hook refuses a multipart body on any other route, exactly as before the parser
 * existed.
 *
 * @param fastify the application's Fastify instance, before Nest registers its routes
 */
export async function registerAttachmentUploads(fastify: FastifyInstance): Promise<void> {
  await fastify.register(multipart, { limits: LIMITS, throwFileSizeLimit: false });
  fastify.addHook("preValidation", async (request) => {
    const upload = request.method === "POST" && request.routeOptions.url === UPLOAD_ROUTE;
    if (request.isMultipart() && !upload) throw new UnsupportedMediaType();
  });
}

/**
 * Reads the upload's parts: `file` (required, read whole within the limit) and an optional `visitId`.
 * The limits above turn a second file, a second field or a third part into `validation`.
 *
 * @param request the upload request, after the access guard
 * @returns the file and the visit it is for
 */
export async function readUpload(request: FastifyRequest): Promise<UploadedFile> {
  if (!request.isMultipart()) throw malformed("file");
  let file: Omit<UploadedFile, "visitId"> | null = null;
  let visitId: string | null = null;
  for await (const part of request.parts()) {
    if (part.type === "file") {
      if (part.fieldname !== "file") throw malformed("file");
      const bytes = await part.toBuffer();
      if (part.file.truncated) throw new ApiError("attachment_too_large");
      file = { fileName: part.filename, declaredType: part.mimetype, bytes };
    } else {
      const parsed = idSchema.safeParse(part.value);
      if (part.fieldname !== "visitId" || part.valueTruncated || !parsed.success) {
        throw malformed("visitId");
      }
      visitId = parsed.data;
    }
  }
  if (file === null) throw malformed("file");
  return { ...file, visitId };
}
