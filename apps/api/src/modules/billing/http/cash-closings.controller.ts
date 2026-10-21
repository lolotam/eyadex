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
  cashClosingListQuerySchema,
  cashClosingListResponseSchema,
  cashClosingPreviewQuerySchema,
  cashClosingResponseSchema,
  createCashClosingRequestSchema,
  type CashClosingListQuery,
  type CashClosingPreview,
  type CreateCashClosingRequest,
} from "@eyadex/contracts/finance";
import type { z } from "zod";

import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
// The one identity import a module may make: guards and request types (CLAUDE.architecture.md §2.2).
import { Require, RequiresFeature, type ClinicRequest } from "../../identity/index.ts";
import { CASH_CLOSING_READS, CASH_CLOSINGS } from "../ports/tokens.ts";
import type { CashClosingReads } from "../use-cases/cash-closings/cash-closing-reads.ts";
import type { CashClosings } from "../use-cases/cash-closings/cash-closings.ts";
import { actorOf, idOf, keyOf } from "./billing-request.ts";

// Spec §4.6. Thin: validate → call → map. The branch keys admit the clinic scope too; the use case
// narrows to the caller's reach (the closing's branch). No route here names a patient.
@Controller()
export class CashClosingsController {
  constructor(
    @Inject(CASH_CLOSINGS) private readonly closings: CashClosings,
    @Inject(CASH_CLOSING_READS) private readonly reads: CashClosingReads,
  ) {}

  @Get("cash-closings/preview")
  @Require("create:cash_closings:branch")
  @RequiresFeature("finance")
  preview(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(cashClosingPreviewQuerySchema)) query: { branchId: string },
  ): Promise<CashClosingPreview> {
    return this.closings.preview(actorOf(request), query.branchId);
  }

  @Post("cash-closings")
  @HttpCode(201)
  @Require("create:cash_closings:branch")
  @RequiresFeature("finance")
  async close(
    @Req() request: ClinicRequest,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body(new ZodValidationPipe(createCashClosingRequestSchema)) body: CreateCashClosingRequest,
  ): Promise<z.infer<typeof cashClosingResponseSchema>> {
    return { cashClosing: await this.closings.close(actorOf(request), body, keyOf(rawKey)) };
  }

  @Get("cash-closings")
  @Require("view:cash_closings:branch")
  @RequiresFeature("finance")
  list(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(cashClosingListQuerySchema)) query: CashClosingListQuery,
  ): Promise<z.infer<typeof cashClosingListResponseSchema>> {
    return this.reads.list(actorOf(request), query);
  }

  @Get("cash-closings/:id")
  @Require("view:cash_closings:branch")
  @RequiresFeature("finance")
  get(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
  ): Promise<z.infer<typeof cashClosingResponseSchema>> {
    return this.reads.get(actorOf(request), idOf(id));
  }
}
