import { Logger as NestLogger, Module } from "@nestjs/common";
import type { Database } from "@eyadex/db";

import { DatabaseModule } from "../../shared/database.module.ts";
import { DATABASE } from "../../shared/database.provider.ts";
import { CLOCK, TenancyModule, type Clock } from "../tenancy/index.ts";
import { AuthorizationCache } from "./access/authorization-cache.ts";
import { AuthorizationCacheModule } from "./access/authorization-cache.module.ts";
import { CLINIC_CONTEXT_RESOLVER, ClinicContextResolver } from "./access/clinic-context.ts";
import { AREA_AUTH, type AreaAuth } from "./auth/area-auth.ts";
import { AuthModule } from "./auth/auth.module.ts";
import { MeController, PermissionsController, RolesController } from "./http/access.controllers.ts";
import { PgMemberAccessReader } from "./persistence/pg-member-access-reader.ts";
import { MEMBER_ACCESS_READER, type MemberAccessReader } from "./ports/member-access-reader.ts";
import {
  MEMBER_SESSION_REVOKER,
  type MemberSessionRevoker,
} from "./ports/member-session-revoker.ts";

const logger = new NestLogger("authorization");

/**
 * سياق العيادة للـ guard العام (ADR-0009) + `/v1/me`, `/v1/permissions/catalogue`, `/v1/roles`.
 * محتاج الـ auth والـ DATABASE_URL والـ REDIS_URL.
 */
@Module({
  imports: [AuthModule, DatabaseModule, TenancyModule, AuthorizationCacheModule],
  controllers: [MeController, PermissionsController, RolesController],
  providers: [
    {
      provide: MEMBER_ACCESS_READER,
      inject: [DATABASE],
      useFactory: (db: Database) => new PgMemberAccessReader(db),
    },
    {
      provide: CLINIC_CONTEXT_RESOLVER,
      inject: [MEMBER_ACCESS_READER, AuthorizationCache, CLOCK],
      useFactory: (reader: MemberAccessReader, cache: AuthorizationCache, clock: Clock) =>
        new ClinicContextResolver({
          reader,
          cache,
          clock,
          logger: { warn: (_fields: unknown, message: string) => logger.warn(message) },
        }),
    },
    {
      provide: MEMBER_SESSION_REVOKER,
      inject: [AREA_AUTH],
      useFactory: (areaAuth: AreaAuth): MemberSessionRevoker => ({
        revokeMemberSessions: (userId) => areaAuth.of("clinic").revokeUserSessions(userId),
      }),
    },
  ],
  exports: [CLINIC_CONTEXT_RESOLVER, AuthorizationCacheModule, MEMBER_SESSION_REVOKER],
})
export class ClinicAccessModule {}
