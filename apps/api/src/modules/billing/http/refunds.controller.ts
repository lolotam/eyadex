import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  createRefundRequestSchema,
  refundListQuerySchema,
  refundListResponseSchema,
  refundResponseSchema,
  type CreateRefundRequest,
  type RefundListQuery,
} from "@eyadex/contracts/finance";
import type { z } from "zod";

import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
// The one identity import a module may make: guards and request types (CLAUDE.architecture.md §2.2).
import { Require, RequiresFeature, type ClinicRequest } from "../../identity/index.ts";
import { INVOICE_REFUNDS, REFUND_READS } from "../ports/tokens.ts";
import type { RefundReads } from "../use-cases/refunds/refund-reads.ts";
import type { InvoiceRefunds, RefundAnswer } from "../use-cases/refunds/refunds.ts";
import { actorOf, idOf, keyOf } from "./billing-request.ts";

// Spec §4.6. Thin: validate → call → map. `create:refunds:branch` and `view:payments:branch` admit the
// clinic scope too; the use case narrows to the caller's reach (the invoice's branch). A refund has no
// view key of its own: it is read through `view:payments` (spec §4.1).
@Controller()
export class RefundsController {
  constructor(
    @Inject(INVOICE_REFUNDS) private readonly refunds: InvoiceRefunds,
    @Inject(REFUND_READS) private readonly reads: RefundReads,
  ) {}

  @Post("invoices/:id/refunds")
  @HttpCode(201)
  @Require("create:refunds:branch")
  @RequiresFeature("finance")
  record(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body(new ZodValidationPipe(createRefundRequestSchema)) body: CreateRefundRequest,
  ): Promise<RefundAnswer> {
    return this.refunds.record(actorOf(request), idOf(id), body, keyOf(rawKey));
  }

  @Get("refunds")
  @Require("view:payments:branch")
  @RequiresFeature("finance")
  list(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(refundListQuerySchema)) query: RefundListQuery,
  ): Promise<z.infer<typeof refundListResponseSchema>> {
    return this.reads.list(actorOf(request), query);
  }

  @Get("refunds/:id")
  @Require("view:payments:branch")
  @RequiresFeature("finance")
  get(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
  ): Promise<z.infer<typeof refundResponseSchema>> {
    return this.reads.get(actorOf(request), idOf(id));
  }
}
