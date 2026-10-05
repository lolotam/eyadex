import { Module } from "@nestjs/common";
import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

import { DatabaseModule } from "../../shared/database.module.ts";
import { DATABASE } from "../../shared/database.provider.ts";
import { CLOCK, TenancyModule, type Clock } from "../tenancy/index.ts";
import { AREA_AUTH, type AreaAuth } from "./auth/area-auth.ts";
import { AuthModule } from "./auth/auth.module.ts";
import { ClinicAreaGuard } from "./auth/clinic-area.guard.ts";
import { PublicRateLimitGuard } from "./auth/public-rate-limit.guard.ts";
import { ACCEPT_INVITATION, InvitationsController } from "./http/invitations.controller.ts";
import { AcceptInvitation } from "./use-cases/accept-invitation/accept-invitation.ts";

/** `POST /v1/invitations/{inspect,accept}` على host العيادة (ADR-0008). محتاج الـ auth والـ DATABASE_URL. */
@Module({
  imports: [AuthModule, DatabaseModule, TenancyModule],
  controllers: [InvitationsController],
  providers: [
    ClinicAreaGuard,
    PublicRateLimitGuard,
    {
      provide: ACCEPT_INVITATION,
      inject: [DATABASE, AREA_AUTH, CLOCK],
      useFactory: (db: Database, areaAuth: AreaAuth, clock: Clock) =>
        new AcceptInvitation({ db, accounts: areaAuth.of("clinic"), clock, ids: systemUuidV7() }),
    },
  ],
})
export class InvitationsModule {}
