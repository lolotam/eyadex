import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import {
  createInvoiceRequestSchema,
  invoiceDraftQuerySchema,
  invoiceListQuerySchema,
  updateInvoiceRequestSchema,
  voidInvoiceRequestSchema,
  type CreateInvoiceRequest,
  type Invoice,
  type InvoiceDraft,
  type InvoiceListQuery,
  type UpdateInvoiceRequest,
  type invoiceListResponseSchema,
} from "@eyadex/contracts/finance";
import type { FastifyReply } from "fastify";
import type { z } from "zod";

import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
// The one identity import a module may make: guards and request types (CLAUDE.architecture.md §2.2).
import { Require, RequiresFeature, type ClinicRequest } from "../../identity/index.ts";
import { INVOICE_CHANGES, INVOICE_DRAFTS, INVOICE_ISSUES, INVOICE_READS } from "../ports/tokens.ts";
import type { InvoiceChanges } from "../use-cases/changes/changes.ts";
import type { InvoiceDrafts } from "../use-cases/draft/draft.ts";
import type { InvoiceIssues } from "../use-cases/issue/issue.ts";
import type { InvoiceReads } from "../use-cases/reads/reads.ts";
import { actorOf, idOf, keyOf, versionOf, withETag } from "./billing-request.ts";

type InvoiceAnswer = { invoice: Invoice };

// Spec §3.3. Thin: validate → call → map. `create:invoices:branch` admits the clinic scope too.
@Controller("invoices")
export class InvoicesController {
  constructor(
    @Inject(INVOICE_DRAFTS) private readonly drafts: InvoiceDrafts,
    @Inject(INVOICE_ISSUES) private readonly issues: InvoiceIssues,
    @Inject(INVOICE_READS) private readonly reads: InvoiceReads,
    @Inject(INVOICE_CHANGES) private readonly changes: InvoiceChanges,
  ) {}

  // view:invoices:own admits the branch and clinic scopes too; the use case narrows to the caller's reach.
  @Get()
  @Require("view:invoices:own")
  @RequiresFeature("finance")
  list(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(invoiceListQuerySchema)) query: InvoiceListQuery,
  ): Promise<z.infer<typeof invoiceListResponseSchema>> {
    return this.reads.list(actorOf(request), query);
  }

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

  @Get(":id")
  @Require("view:invoices:own")
  @RequiresFeature("finance")
  async get(
    @Req() request: ClinicRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("id") id: string,
  ): Promise<InvoiceAnswer> {
    const invoice = await this.reads.get(actorOf(request), idOf(id));
    return withETag(reply, { invoice });
  }

  @Patch(":id")
  @Require("update:invoices:branch")
  @RequiresFeature("finance")
  async edit(
    @Req() request: ClinicRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("id") id: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body(new ZodValidationPipe(updateInvoiceRequestSchema)) body: UpdateInvoiceRequest,
  ): Promise<InvoiceAnswer> {
    const invoice = await this.changes.edit(actorOf(request), idOf(id), versionOf(ifMatch), body);
    return withETag(reply, { invoice });
  }

  @Post(":id/void")
  @HttpCode(200)
  @Require("deactivate:invoices:branch")
  @RequiresFeature("finance")
  async void(
    @Req() request: ClinicRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("id") id: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body(new ZodValidationPipe(voidInvoiceRequestSchema))
    body: z.infer<typeof voidInvoiceRequestSchema>,
  ): Promise<InvoiceAnswer> {
    const invoice = await this.changes.void(
      actorOf(request),
      idOf(id),
      versionOf(ifMatch),
      body.reason,
    );
    return withETag(reply, { invoice });
  }
}
