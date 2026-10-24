import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import * as reports from "@eyadex/contracts/finance-reports";
import type { z } from "zod";

import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
import { Require, RequiresFeature, type ClinicRequest } from "../../identity/index.ts";
import { FINANCE_REPORTS } from "../ports/tokens.ts";
import type { FinanceReports } from "../use-cases/reports/reports.ts";
import { actorOf } from "./billing-request.ts";

@Controller("finance-reports")
export class FinanceReportsController {
  constructor(@Inject(FINANCE_REPORTS) private readonly reads: FinanceReports) {}

  @Get("daily-takings")
  @Require("view:report_takings:branch")
  @RequiresFeature("finance")
  async dailyTakings(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(reports.reportDailyTakingsQuerySchema))
    query: z.infer<typeof reports.reportDailyTakingsQuerySchema>,
  ): Promise<z.infer<typeof reports.reportDailyTakingsResponseSchema>> {
    return reports.reportDailyTakingsResponseSchema.parse(
      await this.reads.dailyTakings(
        actorOf(request),
        query,
        request.clinicMember.preferredLanguage,
      ),
    );
  }

  @Get("period-summary")
  @Require("view:report_takings:branch")
  @RequiresFeature("finance")
  async periodSummary(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(reports.reportPeriodSummaryQuerySchema))
    query: z.infer<typeof reports.reportPeriodSummaryQuerySchema>,
  ): Promise<z.infer<typeof reports.reportPeriodSummaryResponseSchema>> {
    return reports.reportPeriodSummaryResponseSchema.parse(
      await this.reads.periodSummary(
        actorOf(request),
        query,
        request.clinicMember.preferredLanguage,
      ),
    );
  }

  @Get("by-service")
  @Require("view:report_analytics:branch")
  @RequiresFeature("finance")
  async byService(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(reports.reportByServiceQuerySchema))
    query: z.infer<typeof reports.reportByServiceQuerySchema>,
  ): Promise<z.infer<typeof reports.reportByServiceResponseSchema>> {
    return reports.reportByServiceResponseSchema.parse(
      await this.reads.byService(actorOf(request), query, request.clinicMember.preferredLanguage),
    );
  }

  @Get("by-doctor")
  @Require("view:report_analytics:branch")
  @RequiresFeature("finance")
  async byDoctor(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(reports.reportByDoctorQuerySchema))
    query: z.infer<typeof reports.reportByDoctorQuerySchema>,
  ): Promise<z.infer<typeof reports.reportByDoctorResponseSchema>> {
    return reports.reportByDoctorResponseSchema.parse(
      await this.reads.byDoctor(actorOf(request), query, request.clinicMember.preferredLanguage),
    );
  }

  @Get("outstanding")
  @Require("view:report_patients:branch")
  @RequiresFeature("finance")
  async outstanding(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(reports.reportOutstandingQuerySchema))
    query: z.infer<typeof reports.reportOutstandingQuerySchema>,
  ): Promise<z.infer<typeof reports.reportOutstandingResponseSchema>> {
    return reports.reportOutstandingResponseSchema.parse(
      await this.reads.outstanding(actorOf(request), query, request.clinicMember.preferredLanguage),
    );
  }

  @Get("patient-credit")
  @Require("view:report_patients:clinic")
  @RequiresFeature("finance")
  async patientCredit(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(reports.reportPatientCreditQuerySchema))
    query: z.infer<typeof reports.reportPatientCreditQuerySchema>,
  ): Promise<z.infer<typeof reports.reportPatientCreditResponseSchema>> {
    return reports.reportPatientCreditResponseSchema.parse(
      await this.reads.patientCredit(
        actorOf(request),
        query,
        request.clinicMember.preferredLanguage,
      ),
    );
  }

  @Get("refunds")
  @Require("view:report_patients:branch")
  @RequiresFeature("finance")
  async refunds(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(reports.reportRefundQuerySchema))
    query: z.infer<typeof reports.reportRefundQuerySchema>,
  ): Promise<z.infer<typeof reports.reportRefundResponseSchema>> {
    return reports.reportRefundResponseSchema.parse(
      await this.reads.refunds(actorOf(request), query, request.clinicMember.preferredLanguage),
    );
  }

  @Get("discounts")
  @Require("view:report_patients:branch")
  @RequiresFeature("finance")
  async discounts(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(reports.reportDiscountQuerySchema))
    query: z.infer<typeof reports.reportDiscountQuerySchema>,
  ): Promise<z.infer<typeof reports.reportDiscountResponseSchema>> {
    return reports.reportDiscountResponseSchema.parse(
      await this.reads.discounts(actorOf(request), query, request.clinicMember.preferredLanguage),
    );
  }

  @Get("cash-closings")
  @Require("view:report_takings:branch")
  @RequiresFeature("finance")
  async cashClosings(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(reports.reportCashClosingQuerySchema))
    query: z.infer<typeof reports.reportCashClosingQuerySchema>,
  ): Promise<z.infer<typeof reports.reportCashClosingResponseSchema>> {
    return reports.reportCashClosingResponseSchema.parse(
      await this.reads.cashClosings(
        actorOf(request),
        query,
        request.clinicMember.preferredLanguage,
      ),
    );
  }

  @Get("own-summary")
  @Require("view:report_own:own")
  @RequiresFeature("finance")
  async ownSummary(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(reports.reportOwnSummaryQuerySchema))
    query: z.infer<typeof reports.reportOwnSummaryQuerySchema>,
  ): Promise<z.infer<typeof reports.reportOwnSummaryResponseSchema>> {
    return reports.reportOwnSummaryResponseSchema.parse(
      await this.reads.ownSummary(actorOf(request), query, request.clinicMember.preferredLanguage),
    );
  }
}
