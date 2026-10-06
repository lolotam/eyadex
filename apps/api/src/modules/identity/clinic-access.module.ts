import {
  Inject,
  Injectable,
  Logger as NestLogger,
  Module,
  type OnApplicationShutdown,
} from "@nestjs/common";
import type { Database } from "@eyadex/db";
import { Redis } from "ioredis";

import { DatabaseModule } from "../../shared/database.module.ts";
import { DATABASE } from "../../shared/database.provider.ts";
import { CLOCK, TenancyModule, type Clock } from "../tenancy/index.ts";
import { AuthorizationCache } from "./access/authorization-cache.ts";
import { CLINIC_CONTEXT_RESOLVER, ClinicContextResolver } from "./access/clinic-context.ts";
import { AREA_AUTH, type AreaAuth } from "./auth/area-auth.ts";
import { readAuthConfig } from "./auth/auth-config.ts";
import { AuthModule } from "./auth/auth.module.ts";
import { MeController, PermissionsController, RolesController } from "./http/access.controllers.ts";
import { PgMemberAccessReader } from "./persistence/pg-member-access-reader.ts";
import { AUTHORIZATION_INVALIDATOR } from "./ports/authorization-invalidator.ts";
import { MEMBER_ACCESS_READER, type MemberAccessReader } from "./ports/member-access-reader.ts";
import {
  MEMBER_SESSION_REVOKER,
  type MemberSessionRevoker,
} from "./ports/member-session-revoker.ts";

const AUTHZ_REDIS = Symbol("identity.AuthzRedis");

/** بيقفل اتصال Redis بتاع الكاش مع الـ app. */
@Injectable()
export class AuthzRedisCloser implements OnApplicationShutdown {
  constructor(@Inject(AUTHZ_REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}

const logger = new NestLogger("authorization");

/**
 * سياق العيادة للـ guard العام (ADR-0009) + `/v1/me`, `/v1/permissions/catalogue`, `/v1/roles`.
 * محتاج الـ auth والـ DATABASE_URL والـ REDIS_URL.
 */
@Module({
  imports: [AuthModule, DatabaseModule, TenancyModule],
  controllers: [MeController, PermissionsController, RolesController],
  providers: [
    {
      provide: AUTHZ_REDIS,
      useFactory: () => {
        // Short timeouts: a slow Redis must cost a request little before it falls back to the DB.
        const redis = new Redis(readAuthConfig(process.env).REDIS_URL, {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 0,
          commandTimeout: 250,
          connectTimeout: 1_000,
        });
        redis.on("error", () => undefined);
        return redis;
      },
    },
    AuthzRedisCloser,
    {
      provide: AuthorizationCache,
      inject: [AUTHZ_REDIS],
      useFactory: (r: Redis) => new AuthorizationCache(r),
    },
    { provide: AUTHORIZATION_INVALIDATOR, useExisting: AuthorizationCache },
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
  exports: [CLINIC_CONTEXT_RESOLVER, AUTHORIZATION_INVALIDATOR, MEMBER_SESSION_REVOKER],
})
export class ClinicAccessModule {}
