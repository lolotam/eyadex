import { Module } from "@nestjs/common";
import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

import { DatabaseModule } from "../../shared/database.module.ts";
import { DATABASE } from "../../shared/database.provider.ts";
import { CLOCK, TenancyModule, type Clock } from "../tenancy/index.ts";
import { AuthorizationCacheModule } from "./access/authorization-cache.module.ts";
import { ROLE_CHANGES, RoleWritesController } from "./http/roles.controller.ts";
import { UserOptionsController } from "./http/user-options.controller.ts";
import { RoleChanges } from "./use-cases/role-changes/role-changes.ts";

/**
 * الأدوار المخصصة (ADR-0017): كتابة `/v1/roles` واختيارات محرّر المستخدمين
 * (`/v1/users/role-options`، `/v1/users/branch-options`). بيتركّب جنب `ClinicAccessModule` (الـ guard
 * العام وسياق العيادة هناك). محتاج DATABASE_URL و REDIS_URL.
 */
@Module({
  imports: [DatabaseModule, TenancyModule, AuthorizationCacheModule],
  controllers: [RoleWritesController, UserOptionsController],
  providers: [
    {
      provide: ROLE_CHANGES,
      inject: [DATABASE, CLOCK],
      useFactory: (db: Database, clock: Clock) =>
        new RoleChanges({ db, clock, ids: systemUuidV7() }),
    },
  ],
})
export class RolesModule {}
