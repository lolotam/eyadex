import { Module } from "@nestjs/common";
import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

import { DatabaseModule } from "../../shared/database.module.ts";
import { DATABASE } from "../../shared/database.provider.ts";
import { CLOCK, PgFilingBranches, TenancyModule, type Clock } from "../tenancy/index.ts";
import { PatientsController } from "./http/patients.controller.ts";
import type { PatientBranchReader } from "./ports/patient-branch-reader.ts";
import { OPEN_PATIENT, PATIENT_BRANCH_READER, PATIENT_CHANGES } from "./ports/tokens.ts";
import { OpenPatient } from "./use-cases/open-patient/open-patient.ts";
import { PatientChanges } from "./use-cases/patient-changes/patient-changes.ts";

// Typed against the patients port, so tenancy's adapter can never drift from what patients needs.
const filingBranches: PatientBranchReader = new PgFilingBranches();

/**
 * ملفات المراجعين (ADR-0018): `/v1/patients`. كل الشغل على pool الـ `eyadex_app` جوه `withTenant`؛
 * مفيش أي مسار منصة، و`eyadex_platform` مالوش أي grant على المراجعين. جدول الفروع (ملك tenancy)
 * بيتقري بس من port المراجعين `PatientBranchReader`، و tenancy بتنفّذه (`PgFilingBranches`).
 */
@Module({
  imports: [DatabaseModule, TenancyModule],
  controllers: [PatientsController],
  providers: [
    { provide: PATIENT_BRANCH_READER, useValue: filingBranches },
    {
      provide: PATIENT_CHANGES,
      inject: [DATABASE, CLOCK, PATIENT_BRANCH_READER],
      useFactory: (db: Database, clock: Clock, branches: PatientBranchReader) =>
        new PatientChanges({ db, clock, ids: systemUuidV7(), branches }),
    },
    {
      provide: OPEN_PATIENT,
      inject: [DATABASE, CLOCK, PATIENT_BRANCH_READER],
      useFactory: (db: Database, clock: Clock, branches: PatientBranchReader) =>
        new OpenPatient({ db, clock, ids: systemUuidV7(), branches }),
    },
  ],
})
export class PatientsModule {}
