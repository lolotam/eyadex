import { Module, type DynamicModule } from "@nestjs/common";
import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

import { DatabaseModule } from "../../shared/database.module.ts";
import { DATABASE } from "../../shared/database.provider.ts";
import { FIELD_CIPHER, FieldEncryptionModule } from "../../shared/field-encryption.module.ts";
// A module.ts may bind another module's adapter to a port it owns (CLAUDE.architecture.md §2.2,
// ADR-0029): identity's members, tenancy's branches, patients' files and appointments' bookings.
import { PgVisitAppointments } from "../appointments/index.ts";
import { PgProviderDirectory } from "../identity/index.ts";
import { PgMedicalPatients } from "../patients/index.ts";
import {
  CLOCK,
  PgClinicNames,
  PgFilingBranches,
  TenancyModule,
  type Clock,
} from "../tenancy/index.ts";
import { AttachmentsController } from "./http/attachments.controller.ts";
import { Icd10Controller } from "./http/icd10.controller.ts";
import { MedicinesController } from "./http/medicines.controller.ts";
import { PatientMedicalController } from "./http/patient-medical.controller.ts";
import { blobStoreFromEnv } from "./persistence/blob-store-config.ts";
import type { BlobStore } from "./ports/blob-store.ts";
import { VisitsController } from "./http/visits.controller.ts";
import type { ClinicalCipher } from "./ports/clinical-cipher.ts";
import type { MedicalAppointmentReader } from "./ports/medical-appointment-reader.ts";
import type { MedicalBranchReader } from "./ports/medical-branch-reader.ts";
import type { MedicalClinicReader } from "./ports/medical-clinic-reader.ts";
import type { MedicalMemberDirectory } from "./ports/medical-member-directory.ts";
import type { MedicalPatientReader } from "./ports/medical-patient-reader.ts";
import {
  ATTACHMENTS,
  BLOB_STORE,
  CLINICAL_CIPHER,
  MEDICAL_PROFILE_CHANGES,
  MEDICINE_CHANGES,
  PRESCRIPTION_PRINTS,
  START_VISIT,
  VISIT_LIFECYCLE,
  VISIT_LISTS,
  VISIT_READS,
} from "./ports/tokens.ts";
import { Attachments } from "./use-cases/attachments/attachments.ts";
import type { MedicalDeps } from "./use-cases/medical-deps.ts";
import { MedicalProfileChanges } from "./use-cases/medical-profile/medical-profile.ts";
import { MedicineChanges } from "./use-cases/medicine-changes/medicine-changes.ts";
import { PrescriptionPrints } from "./use-cases/prescription-print/prescription-print.ts";
import { StartVisit } from "./use-cases/start-visit/start-visit.ts";
import { VisitLifecycle } from "./use-cases/visit-lifecycle/visit-lifecycle.ts";
import { VisitLists } from "./use-cases/visit-lists/visit-lists.ts";
import { VisitReads } from "./use-cases/visit-reads/visit-reads.ts";

// Typed against the module's own ports, so no adapter can drift from what the module needs.
const patients: MedicalPatientReader = new PgMedicalPatients();
const appointments: MedicalAppointmentReader = new PgVisitAppointments();
const members: MedicalMemberDirectory = new PgProviderDirectory();
const branches: MedicalBranchReader = new PgFilingBranches();
const clinics: MedicalClinicReader = new PgClinicNames();

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
  clinics,
});

/**
 * موديول الطب (ADR-0029): `/v1/visits` و`/v1/patients/:id/visits` و`/v1/patients/:id/medical-profile`
 * و`/v1/icd10/search` و`/v1/medicines` ومرفقات المراجع. كل الشغل على pool الـ `eyadex_app` جوه
 * `withTenant`؛ المنصة مالهاش أي مسار ولا صلاحية على جداوله. الملفات والمواعيد والعضويات والفروع والعيادة
 * بتتقري من ports الموديول بس، وكل عمود `*_enc` ومحتوى كل مرفق بيعدّي على `ClinicalCipher`.
 */
@Module({})
export class MedicalModule {
  /**
   * الموديول بمخزن المرفقات: اللي الاختبار بيديه، وإلا الـ bucket الخاص (S3/MinIO) من البيئة
   * (`MEDICAL_BLOB_S3_*`)، وإلا مخزن مش متظبّط بيرد 503 على الرفع والتنزيل بس، فالـ API بيقوم من غيره.
   *
   * @param blobStore مخزن بديل (الاختبارات بس)
   * @returns الموديول
   */
  static forRoot(blobStore?: BlobStore): DynamicModule {
    return {
      module: MedicalModule,
      imports: [DatabaseModule, TenancyModule, FieldEncryptionModule],
      controllers: [
        VisitsController,
        PatientMedicalController,
        Icd10Controller,
        MedicinesController,
        AttachmentsController,
      ],
      providers: [
        // ADR-0028: the app's one FieldCipher, behind the module's own port.
        { provide: CLINICAL_CIPHER, useExisting: FIELD_CIPHER },
        { provide: BLOB_STORE, useFactory: () => blobStore ?? blobStoreFromEnv(process.env) },
        {
          provide: START_VISIT,
          inject: DEPS,
          useFactory: (...args: Parameters<typeof medicalDeps>) =>
            new StartVisit(medicalDeps(...args)),
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
          useFactory: (...args: Parameters<typeof medicalDeps>) =>
            new VisitReads(medicalDeps(...args)),
        },
        {
          provide: MEDICAL_PROFILE_CHANGES,
          inject: DEPS,
          useFactory: (...args: Parameters<typeof medicalDeps>) =>
            new MedicalProfileChanges(medicalDeps(...args)),
        },
        {
          provide: VISIT_LISTS,
          inject: DEPS,
          useFactory: (...args: Parameters<typeof medicalDeps>) =>
            new VisitLists(medicalDeps(...args)),
        },
        {
          provide: PRESCRIPTION_PRINTS,
          inject: DEPS,
          useFactory: (...args: Parameters<typeof medicalDeps>) =>
            new PrescriptionPrints(medicalDeps(...args)),
        },
        {
          provide: MEDICINE_CHANGES,
          inject: DEPS,
          useFactory: (...args: Parameters<typeof medicalDeps>) =>
            new MedicineChanges(medicalDeps(...args)),
        },
        {
          provide: ATTACHMENTS,
          inject: [...DEPS, BLOB_STORE],
          useFactory: (db: Database, clock: Clock, cipher: ClinicalCipher, blobs: BlobStore) =>
            new Attachments(medicalDeps(db, clock, cipher), blobs),
        },
      ],
    };
  }
}
