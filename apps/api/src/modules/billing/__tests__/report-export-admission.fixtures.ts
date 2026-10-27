import type { ReportId } from "@eyadex/contracts/finance-reports";
import type { Database, Tx } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

import { DATABASE } from "../../../shared/database.provider.ts";
import { PgFilingBranches } from "../../tenancy/persistence/pg-filing-branches.ts";
import type { BillingActor } from "../domain/billing-actor.ts";
import { PgReportExportStore } from "../persistence/pg-report-export-store.ts";
import type { BillingBranchReader } from "../ports/billing-branches.ts";
import { ReportExports } from "../use-cases/report-exports/report-exports.ts";
import { reportFixture, type ReportFixture } from "./report-fixtures.ts";

export const CLOCK_AT = "2026-10-26T08:00:00.000Z";
export const EXPORT_RANGE = { from: "2024-01-01", to: "2026-12-31" };

export const ADMIN_KEYS = [
  "view:report_takings:clinic",
  "view:report_analytics:clinic",
  "view:report_patients:clinic",
  "view:invoices:clinic",
  "view:payments:clinic",
  "view:cash_closings:clinic",
] as const;

export const DESK_KEYS = [
  "view:report_takings:branch",
  "view:invoices:branch",
  "view:payments:branch",
  "view:cash_closings:branch",
] as const;

export const DOCTOR_KEYS = ["view:report_own:own", "view:invoices:own"] as const;

export async function exportFixture() {
  const f = await reportFixture();
  await f.h.owner`UPDATE branches SET is_active = false
    WHERE clinic_id = ${f.C.clinicId} AND id = ${f.C.branchR}`;
  return f;
}

export const exportActor = (
  clinicId: string,
  membershipId: string,
  permissions: readonly string[],
  member: BillingActor["member"],
): BillingActor => ({
  clinicId,
  userId: membershipId,
  membershipId,
  permissions,
  member,
});

export const exportBody = (report: ReportId, extra: Record<string, unknown> = {}) => ({
  report,
  ...EXPORT_RANGE,
  format: "csv",
  language: "ar",
  ...extra,
});

export const filingBranches = (): BillingBranchReader => new PgFilingBranches();

export const listedBranchIds = (db: Database, clinicId: string, language: "ar" | "en" = "ar") =>
  db.withTenant(clinicId, (tx: Tx) =>
    filingBranches()
      .listForOptions(tx, clinicId, language)
      .then((rows) => rows.map((row) => row.id)),
  );

export const exportUseCase = (
  f: ReportFixture,
  extra: Partial<ConstructorParameters<typeof ReportExports>[0]> = {},
) =>
  new ReportExports({
    db: f.h.app.get<Database>(DATABASE),
    clock: { now: () => new Date(CLOCK_AT) },
    ids: systemUuidV7(),
    branches: filingBranches(),
    store: new PgReportExportStore(),
    maxQueuedPerClinic: 20,
    ...extra,
  });

export const appDatabase = (f: ReportFixture) => f.h.app.get<Database>(DATABASE);
