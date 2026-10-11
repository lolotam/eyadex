import { Module } from "@nestjs/common";
import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

import { DatabaseModule } from "../../shared/database.module.ts";
import { DATABASE } from "../../shared/database.provider.ts";
// A module.ts may bind another module's adapter to a port it owns (CLAUDE.architecture.md §2.2,
// ADR-0029): identity's members, tenancy's branches, patients' files and appointments' bookings.
import { PgVisitAppointments } from "../appointments/index.ts";
import { PgProviderDirectory } from "../identity/index.ts";
import { PgMedicalPatients } from "../patients/index.ts";
import { CLOCK, PgFilingBranches, TenancyModule, type Clock } from "../tenancy/index.ts";
import { PatientMedicalController } from "./http/patient-medical.controller.ts";
import { VisitsController } from "./http/visits.controller.ts";
import type { ClinicalCipher } from "./ports/clinical-cipher.ts";
import type { MedicalAppointmentReader } from "./ports/medical-appointment-reader.ts";
import type { MedicalBranchReader } from "./ports/medical-branch-reader.ts";
import type { MedicalMemberDirectory } from "./ports/medical-member-directory.ts";
import type { MedicalPatientReader } from "./ports/medical-patient-reader.ts";
import {
  CLINICAL_CIPHER,
  MEDICAL_PROFILE_CHANGES,
  START_VISIT,
  VISIT_LIFECYCLE,
  VISIT_READS,
} from "./ports/tokens.ts";
import type { MedicalDeps } from "./use-cases/medical-deps.ts";
import { MedicalProfileChanges } from "./use-cases/medical-profile/medical-profile.ts";
import { StartVisit } from "./use-cases/start-visit/start-visit.ts";
import { VisitLifecycle } from "./use-cases/visit-lifecycle/visit-lifecycle.ts";
import { VisitReads } from "./use-cases/visit-reads/visit-reads.ts";

// Typed against the module's own ports, so no adapter can drift from what the module needs.
const patients: MedicalPatientReader = new PgMedicalPatients();
const appointments: MedicalAppointmentReader = new PgVisitAppointments();
const members: MedicalMemberDirectory = new PgProviderDirectory();
const branches: MedicalBranchReader = new PgFilingBranches();

// Replaced by FieldCipher (FIELD_CIPHER, branch p2-crypto) before this module ships (a wiring hold); until
// then nothing clinical can be written or read, never stored in clear.
const NO_CIPHER: ClinicalCipher = {
  seal: () => {
    throw new Error("medical: field cipher not configured");
  },
  open: () => {
    throw new Error("medical: field cipher not configured");
  },
};

const DEPS = [DATABASE, CLOCK, CLINICAL_CIPHER];
const medicalDeps = (db: Database, clock: Clock, cipher: ClinicalCipher): MedicalDeps => ({
  db,
  clock,
  ids: systemUuidV7(),
  cipher,
  patients,
  appointments,
  members,
  branches,
});

/**
 * موديول الطب (ADR-0029): `/v1/visits` و`/v1/patients/:id/visits` و`/v1/patients/:id/medical-profile`. كل
 * الشغل على pool الـ `eyadex_app` جوه `withTenant`؛ المنصة مالهاش أي مسار ولا صلاحية على جداوله. الملفات
 * والمواعيد والعضويات والفروع بتتقري من ports الموديول بس، وكل عمود `*_enc` بيعدّي على `ClinicalCipher`.
 */
@Module({
  imports: [DatabaseModule, TenancyModule],
  controllers: [VisitsController, PatientMedicalController],
  providers: [
    { provide: CLINICAL_CIPHER, useValue: NO_CIPHER },
    {
      provide: START_VISIT,
      inject: DEPS,
      useFactory: (...args: Parameters<typeof medicalDeps>) => new StartVisit(medicalDeps(...args)),
    },
    {
      provide: VISIT_LIFECYCLE,
      inject: DEPS,
      useFactory: (...args: Parameters<typeof medicalDeps>) =>
        new VisitLifecycle(medicalDeps(...args)),
    },
    {
      provide: VISIT_READS,
      inject: DEPS,
      useFactory: (...args: Parameters<typeof medicalDeps>) => new VisitReads(medicalDeps(...args)),
    },
    {
      provide: MEDICAL_PROFILE_CHANGES,
      inject: DEPS,
      useFactory: (...args: Parameters<typeof medicalDeps>) =>
        new MedicalProfileChanges(medicalDeps(...args)),
    },
  ],
})
export class MedicalModule {}
