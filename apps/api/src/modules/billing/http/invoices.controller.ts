import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import {
  createInvoiceRequestSchema,
  invoiceDraftQuerySchema,
  type CreateInvoiceRequest,
  type Invoice,
  type InvoiceDraft,
} from "@eyadex/contracts/finance";
import type { FastifyReply } from "fastify";
import type { z } from "zod";

import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
// The one identity import a module may make: guards and request types (CLAUDE.architecture.md §2.2).
import { Require, RequiresFeature, type ClinicRequest } from "../../identity/index.ts";
import { INVOICE_DRAFTS, INVOICE_ISSUES } from "../ports/tokens.ts";
import type { InvoiceDrafts } from "../use-cases/draft/draft.ts";
import type { InvoiceIssues } from "../use-cases/issue/issue.ts";
import { actorOf, keyOf, withETag } from "./billing-request.ts";

type InvoiceAnswer = { invoice: Invoice };

// Spec §3.3. Thin: validate → call → map. `create:invoices:branch` admits the clinic scope too.
@Controller("invoices")
export class InvoicesController {
  constructor(
    @Inject(INVOICE_DRAFTS) private readonly drafts: InvoiceDrafts,
    @Inject(INVOICE_ISSUES) private readonly issues: InvoiceIssues,
  ) {}

  @Get("draft")
  @Require("create:invoices:branch")
  @RequiresFeature("finance")
  draft(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(invoiceDraftQuerySchema))
    query: z.infer<typeof invoiceDraftQuerySchema>,
  ): Promise<InvoiceDraft> {
    return this.drafts.draft(actorOf(request), query.source, query.id);
  }

  @Post()
  @HttpCode(201)
  @Require("create:invoices:branch")
  @RequiresFeature("finance")
  async issue(
    @Req() request: ClinicRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body(new ZodValidationPipe(createInvoiceRequestSchema)) body: CreateInvoiceRequest,
  ): Promise<InvoiceAnswer> {
    const invoice = await this.issues.issue(actorOf(request), body, keyOf(rawKey));
    return withETag(reply, { invoice });
  }
}
