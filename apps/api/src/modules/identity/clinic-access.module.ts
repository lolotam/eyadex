import { Logger as NestLogger, Module } from "@nestjs/common";
import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

import { DatabaseModule } from "../../shared/database.module.ts";
import { DATABASE } from "../../shared/database.provider.ts";
import {
  BranchChanges,
  CLOCK,
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
  EXCLUSIVE_MEMBER_READER,
} from "./http/branches.controller.ts";
import {
  ClinicInvitationsController,
  INVITATION_CHANGES,
} from "./http/clinic-invitations.controller.ts";
import { USER_CHANGES, UsersController } from "./http/users.controller.ts";
import { PgExclusiveMembers } from "./persistence/pg-exclusive-members.ts";
import { InvitationChanges } from "./use-cases/invitation-changes/invitation-changes.ts";
import { UserChanges } from "./use-cases/user-changes/user-changes.ts";
import { MeController, PermissionsController, RolesController } from "./http/access.controllers.ts";
import { PgMemberAccessReader } from "./persistence/pg-member-access-reader.ts";
import { MEMBER_ACCESS_READER, type MemberAccessReader } from "./ports/member-access-reader.ts";
import {
  MEMBER_SESSION_REVOKER,
  type MemberSessionRevoker,
} from "./ports/member-session-revoker.ts";

const logger = new NestLogger("authorization");

/**
 * سياق العيادة للـ guard العام (ADR-0009) + `/v1/me`, `/v1/permissions/catalogue`, `/v1/roles`,
 * و `/v1/branches` (ADR-0011)، و `/v1/users` + `/v1/invitations` (ADR-0012، محتاج OUTBOX_SEAL_KEY).
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
    ClinicInvitationsController,
  ],
  providers: [
    // tenancy's port, implemented by identity: one binding for the branch writes and the list.
    { provide: EXCLUSIVE_MEMBER_READER, useValue: new PgExclusiveMembers() },
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
