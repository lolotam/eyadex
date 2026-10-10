import { Logger as NestLogger, Module } from "@nestjs/common";
import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

import { DatabaseModule } from "../../shared/database.module.ts";
import { DATABASE } from "../../shared/database.provider.ts";
import {
  BranchChanges,
  CLINIC_READER,
  CLOCK,
  readClinicUsage,
  readPlatformSettings,
  type ClinicReader,
  TenancyModule,
  type Clock,
  type ExclusiveMemberReader,
} from "../tenancy/index.ts";
import { AuthorizationCache } from "./access/authorization-cache.ts";
import { AuthorizationCacheModule } from "./access/authorization-cache.module.ts";
import { CLINIC_CONTEXT_RESOLVER, ClinicContextResolver } from "./access/clinic-context.ts";
import { AREA_AUTH, type AreaAuth } from "./auth/area-auth.ts";
import { AuthModule } from "./auth/auth.module.ts";
import { SecretSealer } from "@eyadex/secrets";
import {
  BRANCH_CHANGES,
  BranchesController,
  CLINIC_USAGE,
  type ClinicUsageReader,
  EXCLUSIVE_MEMBER_READER,
} from "./http/branches.controller.ts";
import {
  ClinicInvitationsController,
  INVITATION_CHANGES,
} from "./http/clinic-invitations.controller.ts";
import {
  BOOKING_PROFILE_CHANGES,
  BookingProfileController,
} from "./http/booking-profile.controller.ts";
import { USER_CHANGES, UsersController } from "./http/users.controller.ts";
import { PgExclusiveMembers } from "./persistence/pg-exclusive-members.ts";
import { PgSeatUsageReader } from "./persistence/pg-seat-usage-reader.ts";
import { InvitationChanges } from "./use-cases/invitation-changes/invitation-changes.ts";
import { BookingProfileChanges } from "./use-cases/booking-profile/booking-profile-changes.ts";
import { UserChanges } from "./use-cases/user-changes/user-changes.ts";
import {
  EXPIRY_ALERT_WINDOW,
  MeController,
  PermissionsController,
  RolesController,
  type ExpiryAlertWindow,
} from "./http/access.controllers.ts";
import { ACCOUNT_CHANGES, AccountController } from "./http/account.controller.ts";
import { AccountChanges } from "./use-cases/account-changes/account-changes.ts";
import { PgMemberAccessReader } from "./persistence/pg-member-access-reader.ts";
import { MEMBER_ACCESS_READER, type MemberAccessReader } from "./ports/member-access-reader.ts";
import {
  MEMBER_SESSION_REVOKER,
  type MemberSessionRevoker,
} from "./ports/member-session-revoker.ts";

const logger = new NestLogger("authorization");

/**
 * سياق العيادة للـ guard العام (ADR-0009) + `/v1/me`, `/v1/account` (ADR-0020), `/v1/permissions/catalogue`, `/v1/roles`,
 * و `/v1/branches` (ADR-0011)، و `/v1/users` + `/v1/invitations` (ADR-0012، محتاج OUTBOX_SEAL_KEY)،
 * و `/v1/users/:id/booking-profile` (ADR-0026).
 * محتاج الـ auth والـ DATABASE_URL والـ REDIS_URL.
 */
@Module({
  imports: [AuthModule, DatabaseModule, TenancyModule, AuthorizationCacheModule],
  controllers: [
    MeController,
    PermissionsController,
    RolesController,
    BranchesController,
    UsersController,
    BookingProfileController,
    ClinicInvitationsController,
    AccountController,
  ],
  providers: [
    {
      // Story 30: the platform's alert window, read on eyadex_app (SELECT only, 0036).
      provide: EXPIRY_ALERT_WINDOW,
      inject: [DATABASE],
      useFactory:
        (db: Database): ExpiryAlertWindow =>
        async () =>
          (await readPlatformSettings(db)).alertDaysBeforeExpiry,
    },
    {
      provide: ACCOUNT_CHANGES,
      inject: [DATABASE, CLOCK],
      useFactory: (db: Database, clock: Clock) =>
        new AccountChanges({ db, clock, ids: systemUuidV7() }),
    },
    // tenancy's port, implemented by identity: one binding for the branch writes and the list.
    { provide: EXCLUSIVE_MEMBER_READER, useValue: new PgExclusiveMembers() },
    {
      // Counters only, under withTenant on eyadex_app (ADR-0016).
      provide: CLINIC_USAGE,
      inject: [DATABASE, CLINIC_READER, CLOCK],
      useFactory: (db: Database, reader: ClinicReader, clock: Clock): ClinicUsageReader => {
        const seats = new PgSeatUsageReader(db);
        return (clinicId) => readClinicUsage(reader, seats, clock, clinicId);
      },
    },
    {
      provide: BRANCH_CHANGES,
      inject: [DATABASE, CLOCK, EXCLUSIVE_MEMBER_READER],
      useFactory: (db: Database, clock: Clock, exclusive: ExclusiveMemberReader) =>
        new BranchChanges({ db, clock, ids: systemUuidV7(), exclusive }),
    },
    {
      provide: USER_CHANGES,
      inject: [DATABASE, CLOCK],
      useFactory: (db: Database, clock: Clock) =>
        new UserChanges({ db, clock, ids: systemUuidV7() }),
    },
    {
      provide: BOOKING_PROFILE_CHANGES,
      inject: [DATABASE, CLOCK],
      useFactory: (db: Database, clock: Clock) =>
        new BookingProfileChanges({ db, clock, ids: systemUuidV7() }),
    },
    {
      provide: INVITATION_CHANGES,
      inject: [DATABASE, CLOCK],
      // The same OUTBOX_SEAL_KEY as onboarding: the worker opens both events with one key (ADR-0006).
      useFactory: (db: Database, clock: Clock) =>
        new InvitationChanges({
          db,
          clock,
          ids: systemUuidV7(),
          sealer: new SecretSealer(process.env["OUTBOX_SEAL_KEY"] ?? ""),
        }),
    },
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
