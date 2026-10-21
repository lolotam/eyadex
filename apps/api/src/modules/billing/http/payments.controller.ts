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
  createCreditApplicationRequestSchema,
  createPaymentRequestSchema,
  invoicePaymentsResponseSchema,
  paymentListQuerySchema,
  paymentListResponseSchema,
  paymentResponseSchema,
  type CreateCreditApplicationRequest,
  type CreatePaymentRequest,
  type PaymentListQuery,
} from "@eyadex/contracts/finance";
import {
  optionListQuerySchema,
  type BranchOptionListResponse,
  type OptionListQuery,
} from "@eyadex/contracts/role-admin";
import type { z } from "zod";

import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
// The one identity import a module may make: guards and request types (CLAUDE.architecture.md §2.2).
import { Require, RequiresFeature, type ClinicRequest } from "../../identity/index.ts";
import { CREDIT_APPLICATIONS, INVOICE_PAYMENTS, PAYMENT_READS } from "../ports/tokens.ts";
import type { PaymentReads } from "../use-cases/payment-reads/payment-reads.ts";
import type {
  CreditApplicationAnswer,
  CreditApplications,
} from "../use-cases/payments/credit-applications.ts";
import type { InvoicePayments, PaymentAnswer } from "../use-cases/payments/payments.ts";
import { actorOf, idOf, keyOf } from "./billing-request.ts";

// Spec §4.6. Thin: validate → call → map. `view:payments:branch` and `create:payments:branch` admit the
// clinic scope too; the use case narrows to the caller's reach (the invoice's branch).
@Controller()
export class PaymentsController {
  constructor(
    @Inject(INVOICE_PAYMENTS) private readonly payments: InvoicePayments,
    @Inject(CREDIT_APPLICATIONS) private readonly credits: CreditApplications,
    @Inject(PAYMENT_READS) private readonly reads: PaymentReads,
  ) {}

  @Get("invoices/:id/payments")
  @Require("view:payments:branch")
  @RequiresFeature("finance")
  invoicePayments(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
  ): Promise<z.infer<typeof invoicePaymentsResponseSchema>> {
    return this.reads.invoicePayments(actorOf(request), idOf(id));
  }

  @Post("invoices/:id/payments")
  @HttpCode(201)
  @Require("create:payments:branch")
  @RequiresFeature("finance")
  record(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body(new ZodValidationPipe(createPaymentRequestSchema)) body: CreatePaymentRequest,
  ): Promise<PaymentAnswer> {
    return this.payments.record(actorOf(request), idOf(id), body, keyOf(rawKey));
  }

  @Post("invoices/:id/credit-applications")
  @HttpCode(201)
  @Require("create:payments:branch")
  @RequiresFeature("finance")
  applyCredit(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body(new ZodValidationPipe(createCreditApplicationRequestSchema))
    body: CreateCreditApplicationRequest,
  ): Promise<CreditApplicationAnswer> {
    return this.credits.applyCredit(actorOf(request), idOf(id), body, keyOf(rawKey));
  }

  @Get("payments")
  @Require("view:payments:branch")
  @RequiresFeature("finance")
  list(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(paymentListQuerySchema)) query: PaymentListQuery,
  ): Promise<z.infer<typeof paymentListResponseSchema>> {
    return this.reads.list(actorOf(request), query);
  }

  // Before `payments/:id`: the receipts screen names and filters the branches it may read in.
  @Get("payments/branch-options")
  @Require("view:payments:branch")
  @RequiresFeature("finance")
  branchOptions(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(optionListQuerySchema)) query: OptionListQuery,
  ): Promise<BranchOptionListResponse> {
    return this.reads.branchOptions(actorOf(request), query);
  }

  @Get("payments/:id")
  @Require("view:payments:branch")
  @RequiresFeature("finance")
  get(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
  ): Promise<z.infer<typeof paymentResponseSchema>> {
    return this.reads.get(actorOf(request), idOf(id));
  }
}
