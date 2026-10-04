import { Module } from "@nestjs/common";
import type { Database } from "@eyadex/db";

import { DatabaseModule } from "../../shared/database.module.ts";
import { DATABASE } from "../../shared/database.provider.ts";
import { SEAT_USAGE_READER } from "../tenancy/index.ts";
import { PgSeatUsageReader } from "./persistence/pg-seat-usage-reader.ts";

// The only place an identity class is bound to a port. identity → tenancy is an allowed arrow
// (CLAUDE.architecture.md §2.2); tenancy never imports identity. Not mounted yet, like tenancy.
@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: SEAT_USAGE_READER,
      inject: [DATABASE],
      useFactory: (db: Database) => new PgSeatUsageReader(db),
    },
  ],
  exports: [SEAT_USAGE_READER],
})
export class IdentityModule {}
