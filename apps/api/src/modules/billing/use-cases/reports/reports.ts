import { instantToWall } from "@eyadex/contracts/clinic-time";
import type { ReportId } from "@eyadex/contracts/finance-reports";
import type { Database, Tx } from "@eyadex/db";

import { ApiError } from "../../../../shared/errors.ts";
import type { Clock } from "../../../tenancy/index.ts";
import type { BillingActor } from "../../domain/billing-actor.ts";
import { reportBranchIds, reportScope } from "../../domain/report-scope.ts";
import { clinicMoneyFacts, type ClinicMoneyFacts } from "../../persistence/pg-cash-drawer.ts";
import type { BillingPatientReader } from "../../ports/billing-patients.ts";
import type { BillingReportStaff } from "../../ports/billing-report-staff.ts";
import { reportRefunds, reportDiscounts } from "../../queries/report-adjustments.ts";
import { byService, byDoctor, ownSummary } from "../../queries/report-analytics.ts";
import { outstanding, patientCredit } from "../../queries/report-balances.ts";
import { dailyTakings, periodSummary, reportCashClosings } from "../../queries/report-takings.ts";
import {
  reportBranches,
  type ReportContext,
  type ReportPageQuery,
  type ReportQuery,
} from "../../queries/report-sql.ts";

type Language = "ar" | "en";
type Grouped = ReportQuery & { groupBy: "day" | "month" };

export class FinanceReports {
  constructor(
    private readonly deps: {
      readonly db: Database;
      readonly clock: Clock;
      readonly patients: BillingPatientReader;
      readonly staff: BillingReportStaff;
    },
  ) {}

  dailyTakings(actor: BillingActor, query: Grouped, language: Language) {
    return this.read("daily_takings", actor, query, language, (tx, ctx) =>
      dailyTakings(tx, ctx, query),
    );
  }

  periodSummary(actor: BillingActor, query: Grouped, language: Language) {
    return this.read("period_summary", actor, query, language, (tx, ctx) =>
      periodSummary(tx, ctx, query),
    );
  }

  byService(actor: BillingActor, query: ReportQuery, language: Language) {
    return this.read("by_service", actor, query, language, (tx, ctx) => byService(tx, ctx, query));
  }

  byDoctor(actor: BillingActor, query: ReportQuery, language: Language) {
    return this.read("by_doctor", actor, query, language, (tx, ctx) =>
      byDoctor(tx, ctx, query, this.deps.staff),
    );
  }

  outstanding(actor: BillingActor, query: ReportPageQuery, language: Language) {
    return this.read("outstanding", actor, query, language, (tx, ctx, facts) =>
      outstanding(
        tx,
        ctx,
        query,
        instantToWall(this.deps.clock.now().toISOString(), facts.timezone).date,
        this.deps.patients,
      ),
    );
  }

  patientCredit(actor: BillingActor, query: ReportPageQuery, language: Language) {
    return this.read("patient_credit", actor, query, language, (tx, ctx) =>
      patientCredit(tx, ctx, query, this.deps.patients),
    );
  }

  refunds(actor: BillingActor, query: ReportPageQuery, language: Language) {
    return this.read("refunds", actor, query, language, (tx, ctx) =>
      reportRefunds(tx, ctx, query, this.deps.patients, this.deps.staff),
    );
  }

  discounts(actor: BillingActor, query: ReportPageQuery, language: Language) {
    return this.read("discounts", actor, query, language, (tx, ctx) =>
      reportDiscounts(tx, ctx, query, this.deps.patients, this.deps.staff),
    );
  }

  cashClosings(actor: BillingActor, query: ReportQuery, language: Language) {
    return this.read("cash_closings", actor, query, language, (tx, ctx) =>
      reportCashClosings(tx, ctx, query, this.deps.staff),
    );
  }

  ownSummary(actor: BillingActor, query: ReportQuery, language: Language) {
    return this.read("own_summary", actor, query, language, (tx, ctx) =>
      ownSummary(tx, ctx, query, actor.membershipId, this.deps.patients),
    );
  }

  private read<T>(
    report: ReportId,
    actor: BillingActor,
    query: ReportQuery,
    language: Language,
    load: (tx: Tx, ctx: ReportContext, facts: ClinicMoneyFacts) => Promise<T>,
  ) {
    const scope = reportScope(actor, report);
    if (scope === null) throw new ApiError("forbidden");
    return this.deps.db.withTenant(actor.clinicId, async (tx) => {
      const branchIds = reportBranchIds(
        scope,
        await reportBranches(tx, actor.clinicId),
        query.branchId,
      );
      if (branchIds === null) throw new ApiError("forbidden");
      const facts = await clinicMoneyFacts(tx, actor.clinicId);
      const result = await load(tx, { clinicId: actor.clinicId, branchIds, language }, facts);
      return { ...result, currency: facts.currency, currencyExponent: facts.currencyExponent };
    });
  }
}
