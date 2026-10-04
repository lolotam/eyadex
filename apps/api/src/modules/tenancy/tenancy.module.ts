import { Module } from "@nestjs/common";
import type { Database } from "@eyadex/db";

import { DATABASE, databaseProvider } from "../../shared/database.provider.ts";
import { PgBranchReader } from "./persistence/pg-branch-reader.ts";
import { PgClinicReader } from "./persistence/pg-clinic-reader.ts";
import { BRANCH_READER } from "./ports/branch-reader.ts";
import { CLINIC_READER } from "./ports/clinic-reader.ts";
import { CLOCK, type Clock } from "./ports/clock.ts";

const systemClock: Clock = { now: () => new Date() };

// The only place a tenancy port is bound to a class. Not imported by the app yet: no guards exist
// until the identity slice, and CLAUDE.md §6 allows no endpoint without one.
@Module({
  providers: [
    databaseProvider,
    { provide: CLOCK, useValue: systemClock },
    {
      provide: CLINIC_READER,
      inject: [DATABASE],
      useFactory: (db: Database) => new PgClinicReader(db),
    },
    {
      provide: BRANCH_READER,
      inject: [DATABASE],
      useFactory: (db: Database) => new PgBranchReader(db),
    },
  ],
  exports: [CLOCK, CLINIC_READER, BRANCH_READER],
})
export class TenancyModule {}
