import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import { invoiceDraftQuerySchema, type InvoiceDraft } from "@eyadex/contracts/finance";
import type { z } from "zod";

import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
// The one identity import a module may make: guards and request types (CLAUDE.architecture.md §2.2).
import { Require, RequiresFeature, type ClinicRequest } from "../../identity/index.ts";
import { INVOICE_DRAFTS } from "../ports/tokens.ts";
import type { InvoiceDrafts } from "../use-cases/draft/draft.ts";
import { actorOf } from "./billing-request.ts";

// Spec §3.3. Thin: validate → call → map. `create:invoices:branch` admits the clinic scope too.
@Controller("invoices")
export class InvoicesController {
  constructor(@Inject(INVOICE_DRAFTS) private readonly drafts: InvoiceDrafts) {}

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
}
