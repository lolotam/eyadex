import { Module } from "@nestjs/common";
import type { Database } from "@eyadex/db";

import { DatabaseModule } from "../../shared/database.module.ts";
import { DATABASE } from "../../shared/database.provider.ts";
import { PLATFORM_DATABASE, PlatformDatabaseModule } from "../../shared/platform-database.ts";
import { ClinicAuditController } from "./http/clinic-audit.controller.ts";
import { PlatformAuditController } from "./http/platform-audit.controller.ts";
import {
  CLINIC_AUDIT_READER,
  PLATFORM_AUDIT_READER,
  type ClinicAuditReader,
  type PlatformAuditReader,
} from "./ports/audit-readers.ts";
import { listClinicAudit } from "./queries/clinic-audit-list.ts";
import { listPlatformAudit, listPlatformAuditClinics } from "./queries/platform-audit-list.ts";

/** سجل العيادة (ADR-0019): `GET /v1/clinic/audit` على pool الـ `eyadex_app`. محتاج DATABASE_URL. */
@Module({
  imports: [DatabaseModule],
  controllers: [ClinicAuditController],
  providers: [
    {
      provide: CLINIC_AUDIT_READER,
      inject: [DATABASE],
      useFactory: (db: Database): ClinicAuditReader => ({
        list: (scope, query) => listClinicAudit(db, scope, query),
      }),
    },
  ],
})
export class ClinicAuditModule {}

/**
 * سجل المنصة (ADR-0019): `GET /v1/platform/audit` و`/clinics` على pool الـ `eyadex_platform`، اللي
 * ماعندوش grant على `audit_log` (PLAT-01). محتاج PLATFORM_DATABASE_URL.
 */
@Module({
  imports: [PlatformDatabaseModule],
  controllers: [PlatformAuditController],
  providers: [
    {
      provide: PLATFORM_AUDIT_READER,
      inject: [PLATFORM_DATABASE],
      useFactory: (db: Database): PlatformAuditReader => ({
        list: (query) => listPlatformAudit(db, query),
        clinicOptions: () => listPlatformAuditClinics(db),
      }),
    },
  ],
})
export class PlatformAuditModule {}
