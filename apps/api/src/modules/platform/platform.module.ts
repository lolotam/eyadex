import { Module } from "@nestjs/common";
import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

import {
  PLATFORM_DATABASE,
  PlatformDatabaseModule,
  readPlatformConfig,
} from "../../shared/platform-database.ts";
import { SecretSealer } from "../../shared/secret-sealer.ts";
import { AuthModule, IdentityModule } from "../identity/index.ts";
import {
  CLOCK,
  CreateClinicWithAdmin,
  FIRST_ADMIN_PROVISIONER,
  TenancyModule,
  type Clock,
  type FirstAdminProvisioner,
} from "../tenancy/index.ts";
import { CREATE_CLINIC, PlatformClinicsController } from "./http/platform-clinics.controller.ts";

/**
 * منطقة المنصة: `POST /v1/platform/clinics`. الـ use case بتاع `tenancy` بيتركّب هنا على pool
 * `eyadex_platform`، والـ port بتاع أول أدمن من `identity` (ADR-0006).
 */
@Module({
  imports: [AuthModule, IdentityModule, TenancyModule, PlatformDatabaseModule],
  controllers: [PlatformClinicsController],
  providers: [
    {
      provide: CREATE_CLINIC,
      inject: [PLATFORM_DATABASE, CLOCK, FIRST_ADMIN_PROVISIONER],
      useFactory: (db: Database, clock: Clock, provisioner: FirstAdminProvisioner) =>
        new CreateClinicWithAdmin({
          db,
          clock,
          ids: systemUuidV7(),
          provisioner,
          sealer: new SecretSealer(readPlatformConfig(process.env).OUTBOX_SEAL_KEY),
        }),
    },
  ],
})
export class PlatformModule {}
