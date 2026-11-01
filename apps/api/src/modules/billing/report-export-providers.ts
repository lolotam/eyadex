import type { Provider } from "@nestjs/common";
import type { Database } from "@eyadex/db";
import type { FieldCipher } from "@eyadex/secrets";
import { systemUuidV7 } from "@eyadex/ids";
import { DATABASE } from "../../shared/database.provider.ts";
import { FIELD_CIPHER } from "../../shared/field-encryption.module.ts";
import { CLOCK, type Clock } from "../tenancy/index.ts";
import type { BillingBranchReader } from "./ports/billing-branches.ts";
import type { BillingPatientReader } from "./ports/billing-patients.ts";
import type { ReportExportAccessReader, ReportExportFiles } from "./ports/report-export-access.ts";
import { ReportExports } from "./use-cases/report-exports/report-exports.ts";
import { DownloadReportExport } from "./use-cases/report-exports/download-report-export.ts";
import { PgReportExportStore } from "./persistence/pg-report-export-store.ts";
import {
  DOWNLOAD_REPORT_EXPORT,
  REPORT_EXPORT_FILES,
  REPORT_EXPORTS,
} from "./http/report-exports.controller.ts";

/** Runtime is enabled only with an explicitly validated queue bound and private storage. */
export interface ReportExportRuntime {
  readonly maxQueuedPerClinic: number;
  readonly files: ReportExportFiles;
}

export function reportExportProviders(
  runtime: ReportExportRuntime,
  access: ReportExportAccessReader,
  branches: BillingBranchReader,
  patients: BillingPatientReader,
): Provider[] {
  return [
    { provide: REPORT_EXPORT_FILES, useValue: runtime.files },
    {
      provide: REPORT_EXPORTS,
      inject: [DATABASE, CLOCK],
      useFactory: (db: Database, clock: Clock) =>
        new ReportExports({
          db,
          clock,
          ids: systemUuidV7(),
          branches,
          store: new PgReportExportStore(),
          maxQueuedPerClinic: runtime.maxQueuedPerClinic,
        }),
    },
    {
      provide: DOWNLOAD_REPORT_EXPORT,
      inject: [DATABASE, FIELD_CIPHER],
      useFactory: (db: Database, cipher: FieldCipher) =>
        new DownloadReportExport({ db, access, branches, patients, files: runtime.files, cipher }),
    },
  ];
}
