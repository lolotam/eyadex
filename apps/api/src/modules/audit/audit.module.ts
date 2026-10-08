import { Module } from "@nestjs/common";
import type { Database } from "@eyadex/db";

import { DatabaseModule } from "../../shared/database.module.ts";
import { DATABASE } from "../../shared/database.provider.ts";
import { PLATFORM_DATABASE, PlatformDatabaseModule } from "../../shared/platform-database.ts";
import { PgMemberNames, PgRoleNames } from "../identity/index.ts";
import { PgClinicNames, PgFilingBranches } from "../tenancy/index.ts";
import { ClinicAuditController } from "./http/clinic-audit.controller.ts";
import { PlatformAuditController } from "./http/platform-audit.controller.ts";
import { AUDIT_NAME_READERS, type AuditNameReaders } from "./ports/audit-name-readers.ts";
import {
  CLINIC_AUDIT_READER,
  PLATFORM_AUDIT_READER,
  type ClinicAuditReader,
  type PlatformAuditReader,
} from "./ports/audit-readers.ts";
import { listClinicAudit } from "./queries/clinic-audit-list.ts";
import { listPlatformAudit, listPlatformAuditClinics } from "./queries/platform-audit-list.ts";

// Typed against the audit ports, so an owner's adapter can never drift from what the audit log needs.
// Other modules' tables (memberships and roles: identity; branches and clinics: tenancy) are read only
// through these (apps/api/AGENTS.md); the stateless adapters serve both pools.
const nameReaders: AuditNameReaders = {
  members: new PgMemberNames(),
  roles: new PgRoleNames(),
  branches: new PgFilingBranches(),
  clinics: new PgClinicNames(),
};

/** سجل العيادة (ADR-0019): `GET /v1/clinic/audit` على pool الـ `eyadex_app`. محتاج DATABASE_URL. */
@Module({
  imports: [DatabaseModule],
  controllers: [ClinicAuditController],
  providers: [
    { provide: AUDIT_NAME_READERS, useValue: nameReaders },
    {
      provide: CLINIC_AUDIT_READER,
      inject: [DATABASE, AUDIT_NAME_READERS],
      useFactory: (db: Database, readers: AuditNameReaders): ClinicAuditReader => ({
        list: (scope, query) => listClinicAudit(db, readers, scope, query),
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
    { provide: AUDIT_NAME_READERS, useValue: nameReaders },
    {
      provide: PLATFORM_AUDIT_READER,
      inject: [PLATFORM_DATABASE, AUDIT_NAME_READERS],
      useFactory: (db: Database, readers: AuditNameReaders): PlatformAuditReader => ({
        list: (query) => listPlatformAudit(db, readers, query),
        clinicOptions: () => listPlatformAuditClinics(db, readers),
      }),
    },
  ],
})
export class PlatformAuditModule {}
