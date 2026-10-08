import { Module } from "@nestjs/common";
import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";
import { SecretSealer } from "@eyadex/secrets";

import {
  PLATFORM_DATABASE,
  PlatformDatabaseModule,
  readPlatformConfig,
} from "../../shared/platform-database.ts";
import { CLOCK, TenancyModule, type Clock } from "../tenancy/index.ts";
import { AREA_AUTH, type AreaAuth } from "./auth/area-auth.ts";
import { AuthModule } from "./auth/auth.module.ts";
import { PlatformAreaGuard } from "./auth/platform-area.guard.ts";
import { PublicRateLimitGuard } from "./auth/public-rate-limit.guard.ts";
import {
  ACCEPT_PLATFORM_INVITATION,
  PlatformInvitationsController,
} from "./http/platform-invitations.controller.ts";
import { PgPlatformAccountGate } from "./persistence/pg-platform-account-gate.ts";
import { PLATFORM_ACCOUNT_GATE } from "./ports/platform-account-gate.ts";
import {
  PLATFORM_SESSION_REVOKER,
  type PlatformSessionRevoker,
} from "./ports/platform-session-revoker.ts";
import { AcceptPlatformInvitation } from "./use-cases/platform-team/accept-platform-invitation.ts";
import { PlatformTeamChanges } from "./use-cases/platform-team/platform-team-changes.ts";

export const PLATFORM_TEAM_CHANGES = Symbol("identity.PlatformTeamChanges");

/**
 * فريق المنصة (ADR-0020): الـ gate اللي `AccessGuard` بيسأله في كل طلب منصة، تغييرات الفريق (الـ HTTP
 * بتاعها في موديول `platform`)، وقبول الدعوة العام على host المنصة. على pool `eyadex_platform`.
 */
@Module({
  imports: [AuthModule, PlatformDatabaseModule, TenancyModule],
  controllers: [PlatformInvitationsController],
  providers: [
    PlatformAreaGuard,
    PublicRateLimitGuard,
    {
      provide: PLATFORM_ACCOUNT_GATE,
      inject: [PLATFORM_DATABASE],
      useFactory: (db: Database) => new PgPlatformAccountGate(db),
    },
    {
      provide: PLATFORM_TEAM_CHANGES,
      inject: [PLATFORM_DATABASE, CLOCK],
      useFactory: (db: Database, clock: Clock) =>
        new PlatformTeamChanges({
          db,
          clock,
          ids: systemUuidV7(),
          // The same OUTBOX_SEAL_KEY as onboarding: the worker opens every sealed link with one key.
          sealer: new SecretSealer(readPlatformConfig(process.env).OUTBOX_SEAL_KEY),
        }),
    },
    {
      provide: ACCEPT_PLATFORM_INVITATION,
      inject: [PLATFORM_DATABASE, AREA_AUTH, CLOCK],
      useFactory: (db: Database, areaAuth: AreaAuth, clock: Clock) =>
        new AcceptPlatformInvitation({
          db,
          accounts: areaAuth.of("platform"),
          clock,
          ids: systemUuidV7(),
        }),
    },
    {
      provide: PLATFORM_SESSION_REVOKER,
      inject: [AREA_AUTH],
      useFactory: (areaAuth: AreaAuth): PlatformSessionRevoker => ({
        revokePlatformSessions: (userId) => areaAuth.of("platform").revokeUserSessions(userId),
      }),
    },
  ],
  exports: [PLATFORM_ACCOUNT_GATE, PLATFORM_TEAM_CHANGES, PLATFORM_SESSION_REVOKER],
})
export class PlatformTeamModule {}
