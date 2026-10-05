import { Module } from "@nestjs/common";
import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

import { DatabaseModule } from "../../shared/database.module.ts";
import { DATABASE } from "../../shared/database.provider.ts";
import { FIRST_ADMIN_PROVISIONER, SEAT_USAGE_READER } from "../tenancy/index.ts";
import { PgFirstAdminProvisioner } from "./persistence/pg-first-admin-provisioner.ts";
import { PgSeatUsageReader } from "./persistence/pg-seat-usage-reader.ts";

// The only place an identity class is bound to a port. identity → tenancy is an allowed arrow
// (CLAUDE.architecture.md §2.2); tenancy never imports identity. Mounted through the platform module.
@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: SEAT_USAGE_READER,
      inject: [DATABASE],
      useFactory: (db: Database) => new PgSeatUsageReader(db),
    },
    // Stateless: it writes through the onboarding transaction it is handed (tenancy's withNewTenant).
    { provide: FIRST_ADMIN_PROVISIONER, useFactory: () => new PgFirstAdminProvisioner(systemUuidV7()) },
  ],
  exports: [SEAT_USAGE_READER, FIRST_ADMIN_PROVISIONER],
})
export class IdentityModule {}
