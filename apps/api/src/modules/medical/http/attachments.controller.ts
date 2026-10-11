import {
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  StreamableFile,
} from "@nestjs/common";
import {
  attachmentListQuerySchema,
  type AttachmentList,
  type AttachmentWriteResponse,
} from "@eyadex/contracts/attachments";
import type { z } from "zod";

import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
// The one identity import a module may make: guards and request types (CLAUDE.architecture.md §2.2).
import { Require, RequiresFeature, type ClinicRequest } from "../../identity/index.ts";
import { ATTACHMENTS } from "../ports/tokens.ts";
import type { Attachments } from "../use-cases/attachments/attachments.ts";
import { readUpload } from "./attachment-upload.ts";
import { actorOf, idOf } from "./medical-request.ts";

type AttachmentListQuery = z.infer<typeof attachmentListQuerySchema>;

/**
 * `attachment; filename="<ascii>"; filename*=UTF-8''<utf-8>` (RFC 6266): the ASCII fallback drops
 * anything outside printable ASCII and every quote or backslash, so a name can never end the header
 * value or add one.
 *
 * @returns the header value
 */
export function attachmentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

// Spec §5, R1-14 (P2-10): a patient's attachments. The upload is the API's only multipart route; nothing
// clinical travels in a URL (the visit filter is an id). Reads need `view:medical:*`, writes
// `update:medical:*`; the use case narrows `own` to the caller's patients.
@Controller()
export class AttachmentsController {
  constructor(@Inject(ATTACHMENTS) private readonly attachments: Attachments) {}

  @Post("patients/:id/attachments")
  @HttpCode(201)
  @Require("update:medical:own")
  @RequiresFeature("medical")
  async upload(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
  ): Promise<AttachmentWriteResponse> {
    const patientId = idOf(id);
    const file = await readUpload(request);
    return { attachment: await this.attachments.upload(actorOf(request), patientId, file) };
  }

  @Get("patients/:id/attachments")
  @Require("view:medical:own")
  @RequiresFeature("medical")
  async list(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Query(new ZodValidationPipe(attachmentListQuerySchema)) query: AttachmentListQuery,
  ): Promise<AttachmentList> {
    return this.attachments.list(actorOf(request), idOf(id), query.visitId);
  }

  @Get("attachments/:id")
  @Header("cache-control", "private, no-store")
  @Require("view:medical:own")
  @RequiresFeature("medical")
  async download(@Req() request: ClinicRequest, @Param("id") id: string): Promise<StreamableFile> {
    const file = await this.attachments.download(actorOf(request), idOf(id));
    return new StreamableFile(file.bytes, {
      type: file.contentType,
      length: file.bytes.length,
      disposition: attachmentDisposition(file.name),
    });
  }

  @Post("attachments/:id/archive")
  @HttpCode(200)
  @Require("update:medical:own")
  @RequiresFeature("medical")
  async archive(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
  ): Promise<AttachmentWriteResponse> {
    return { attachment: await this.attachments.archive(actorOf(request), idOf(id)) };
  }
}
