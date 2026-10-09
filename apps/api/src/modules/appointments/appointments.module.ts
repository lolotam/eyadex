import { Module } from "@nestjs/common";
import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

import { DatabaseModule } from "../../shared/database.module.ts";
import { DATABASE } from "../../shared/database.provider.ts";
// A module.ts may bind an identity adapter to a port it owns (CLAUDE.architecture.md §2.2, ADR-0026).
import { PgProviderDirectory } from "../identity/index.ts";
import { CLOCK, PgFilingBranches, TenancyModule, type Clock } from "../tenancy/index.ts";
import { ServicesController } from "./http/services.controller.ts";
import type { ProviderDirectory } from "./ports/provider-directory.ts";
import type { SchedulingBranchReader } from "./ports/scheduling-branch-reader.ts";
import { PROVIDER_DIRECTORY, SCHEDULING_BRANCH_READER, SERVICE_CHANGES } from "./ports/tokens.ts";
import { ServiceChanges } from "./use-cases/service-changes/service-changes.ts";

// Typed against the module's own ports, so neither adapter can drift from what the module needs.
const providers: ProviderDirectory = new PgProviderDirectory();
const branches: SchedulingBranchReader = new PgFilingBranches();

/**
 * موديول المواعيد (ADR-0026): `/v1/services`، `/v1/schedules`. كل الشغل على pool الـ `eyadex_app` جوه
 * `withTenant`؛ مفيش أي مسار منصة. العضويات (identity) والفروع (tenancy) بتتقري من ports الموديول بس.
 */
@Module({
  imports: [DatabaseModule, TenancyModule],
  controllers: [ServicesController],
  providers: [
    { provide: PROVIDER_DIRECTORY, useValue: providers },
    { provide: SCHEDULING_BRANCH_READER, useValue: branches },
    {
      provide: SERVICE_CHANGES,
      inject: [DATABASE, CLOCK],
      useFactory: (db: Database, clock: Clock) =>
        new ServiceChanges({ db, clock, ids: systemUuidV7() }),
    },
  ],
})
export class AppointmentsModule {}
