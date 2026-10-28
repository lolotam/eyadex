import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import type { ReportId } from "@eyadex/contracts/finance-reports";
import {
  branchOptionListResponseSchema,
  optionListQuerySchema,
  type OptionListQuery,
} from "@eyadex/contracts/role-admin";

import { parseContract } from "../../../shared/contract-parser.ts";
import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
import { Require, RequiresFeature, type ClinicRequest } from "../../identity/index.ts";
import { FINANCE_REPORTS } from "../ports/tokens.ts";
import type { FinanceReports } from "../use-cases/reports/reports.ts";
import { actorOf } from "./billing-request.ts";

@Controller("finance-reports")
export class ReportBranchOptionsController {
  constructor(@Inject(FINANCE_REPORTS) private readonly reads: FinanceReports) {}

  @Get("daily-takings/branch-options")
  @Require("view:report_takings:branch")
  @RequiresFeature("finance")
  dailyTakings(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(optionListQuerySchema)) query: OptionListQuery,
  ) {
    return this.options(request, "daily_takings", query);
  }

  @Get("period-summary/branch-options")
  @Require("view:report_takings:branch")
  @RequiresFeature("finance")
  periodSummary(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(optionListQuerySchema)) query: OptionListQuery,
  ) {
    return this.options(request, "period_summary", query);
  }

  @Get("by-service/branch-options")
  @Require("view:report_analytics:branch")
  @RequiresFeature("finance")
  byService(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(optionListQuerySchema)) query: OptionListQuery,
  ) {
    return this.options(request, "by_service", query);
  }

  @Get("by-doctor/branch-options")
  @Require("view:report_analytics:branch")
  @RequiresFeature("finance")
  byDoctor(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(optionListQuerySchema)) query: OptionListQuery,
  ) {
    return this.options(request, "by_doctor", query);
  }

  @Get("outstanding/branch-options")
  @Require("view:report_patients:branch")
  @RequiresFeature("finance")
  outstanding(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(optionListQuerySchema)) query: OptionListQuery,
  ) {
    return this.options(request, "outstanding", query);
  }

  @Get("patient-credit/branch-options")
  @Require("view:report_patients:clinic")
  @RequiresFeature("finance")
  patientCredit(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(optionListQuerySchema)) query: OptionListQuery,
  ) {
    return this.options(request, "patient_credit", query);
  }

  @Get("refunds/branch-options")
  @Require("view:report_patients:branch")
  @RequiresFeature("finance")
  refunds(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(optionListQuerySchema)) query: OptionListQuery,
  ) {
    return this.options(request, "refunds", query);
  }

  @Get("discounts/branch-options")
  @Require("view:report_patients:branch")
  @RequiresFeature("finance")
  discounts(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(optionListQuerySchema)) query: OptionListQuery,
  ) {
    return this.options(request, "discounts", query);
  }

  @Get("cash-closings/branch-options")
  @Require("view:report_takings:branch")
  @RequiresFeature("finance")
  cashClosings(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(optionListQuerySchema)) query: OptionListQuery,
  ) {
    return this.options(request, "cash_closings", query);
  }

  @Get("own-summary/branch-options")
  @Require("view:report_own:own")
  @RequiresFeature("finance")
  ownSummary(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(optionListQuerySchema)) query: OptionListQuery,
  ) {
    return this.options(request, "own_summary", query);
  }

  private async options(request: ClinicRequest, report: ReportId, query: OptionListQuery) {
    return parseContract(
      branchOptionListResponseSchema,
      await this.reads.branchOptions(actorOf(request), report, query),
    );
  }
}
