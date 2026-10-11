import { Module } from "@nestjs/common";
import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

import { DatabaseModule } from "../../shared/database.module.ts";
import { DATABASE } from "../../shared/database.provider.ts";
import {
  CIVIL_ID_INDEX_KEY,
  FIELD_CIPHER,
  FieldEncryptionModule,
} from "../../shared/field-encryption.module.ts";
import { CLOCK, PgFilingBranches, TenancyModule, type Clock } from "../tenancy/index.ts";
import { PatientsController } from "./http/patients.controller.ts";
import { CivilIdCodec, type CivilIdCipher } from "./persistence/civil-id-codec.ts";
import type { PatientBranchReader } from "./ports/patient-branch-reader.ts";
import {
  OPEN_PATIENT,
  PATIENT_BRANCH_READER,
  PATIENT_CHANGES,
  PATIENT_CIVIL_IDS,
} from "./ports/tokens.ts";
import { OpenPatient } from "./use-cases/open-patient/open-patient.ts";
import { PatientChanges } from "./use-cases/patient-changes/patient-changes.ts";

// Typed against the patients port, so tenancy's adapter can never drift from what patients needs.
const filingBranches: PatientBranchReader = new PgFilingBranches();

const DEPS = [DATABASE, CLOCK, PATIENT_BRANCH_READER, PATIENT_CIVIL_IDS];
const patientDeps = (
  db: Database,
  clock: Clock,
  branches: PatientBranchReader,
  civilIds: CivilIdCodec,
) => ({ db, clock, ids: systemUuidV7(), branches, civilIds });

/**
 * ملفات المراجعين (ADR-0018): `/v1/patients`. كل الشغل على pool الـ `eyadex_app` جوه `withTenant`؛
 * مفيش أي مسار منصة، و`eyadex_platform` مالوش أي grant على المراجعين. جدول الفروع (ملك tenancy)
 * بيتقري بس من port المراجعين `PatientBranchReader`، و tenancy بتنفّذه (`PgFilingBranches`).
 */
@Module({
  imports: [DatabaseModule, TenancyModule, FieldEncryptionModule],
  controllers: [PatientsController],
  providers: [
    { provide: PATIENT_BRANCH_READER, useValue: filingBranches },
    // ADR-0028: the civil ID is sealed with the app's FieldCipher and indexed with MEDICAL_INDEX_KEY.
    {
      provide: PATIENT_CIVIL_IDS,
      inject: [FIELD_CIPHER, CIVIL_ID_INDEX_KEY],
      useFactory: (cipher: CivilIdCipher, indexKey: Buffer) => new CivilIdCodec(cipher, indexKey),
    },
    {
      provide: PATIENT_CHANGES,
      inject: DEPS,
      useFactory: (...args: Parameters<typeof patientDeps>) =>
        new PatientChanges(patientDeps(...args)),
    },
    {
      provide: OPEN_PATIENT,
      inject: DEPS,
      useFactory: (...args: Parameters<typeof patientDeps>) =>
        new OpenPatient(patientDeps(...args)),
    },
  ],
})
export class PatientsModule {}
