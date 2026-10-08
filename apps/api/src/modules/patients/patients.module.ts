import { Module } from "@nestjs/common";
import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

import { DatabaseModule } from "../../shared/database.module.ts";
import { DATABASE } from "../../shared/database.provider.ts";
import { CLOCK, TenancyModule, type Clock } from "../tenancy/index.ts";
import { PatientsController } from "./http/patients.controller.ts";
import { OPEN_PATIENT, PATIENT_CHANGES } from "./ports/tokens.ts";
import { OpenPatient } from "./use-cases/open-patient/open-patient.ts";
import { PatientChanges } from "./use-cases/patient-changes/patient-changes.ts";

/**
 * ملفات المراجعين (ADR-0018): `/v1/patients`. كل الشغل على pool الـ `eyadex_app` جوه `withTenant`؛
 * مفيش أي مسار منصة، و`eyadex_platform` مالوش أي grant على المراجعين.
 */
@Module({
  imports: [DatabaseModule, TenancyModule],
  controllers: [PatientsController],
  providers: [
    {
      provide: PATIENT_CHANGES,
      inject: [DATABASE, CLOCK],
      useFactory: (db: Database, clock: Clock) =>
        new PatientChanges({ db, clock, ids: systemUuidV7() }),
    },
    {
      provide: OPEN_PATIENT,
      inject: [DATABASE, CLOCK],
      useFactory: (db: Database, clock: Clock) =>
        new OpenPatient({ db, clock, ids: systemUuidV7() }),
    },
  ],
})
export class PatientsModule {}
