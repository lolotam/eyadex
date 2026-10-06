import { Module } from "@nestjs/common";
import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

import {
  PLATFORM_DATABASE,
  PlatformDatabaseModule,
  readPlatformConfig,
} from "../../shared/platform-database.ts";
import { SecretSealer } from "../../shared/secret-sealer.ts";
import {
  AuthModule,
  AuthorizationCacheModule,
  IdentityModule,
  PgSeatUsageReader,
} from "../identity/index.ts";
import {
  CLOCK,
  CreateClinicWithAdmin,
  FIRST_ADMIN_PROVISIONER,
  getPlatformClinicDetail,
  PgClinicReader,
  PlatformClinicChanges,
  TenancyModule,
  type Clock,
  type FirstAdminProvisioner,
} from "../tenancy/index.ts";
import {
  PLATFORM_CLINIC_CHANGES,
  PLATFORM_CLINIC_DETAIL,
  PlatformClinicAdminController,
  type ClinicDetailReader,
} from "./http/platform-clinic-admin.controller.ts";
import { CREATE_CLINIC, PlatformClinicsController } from "./http/platform-clinics.controller.ts";

/**
 * منطقة المنصة: `POST /v1/platform/clinics` + تفاصيل العيادة واشتراكها وحدودها وموديولاتها (ADR-0010). الـ use case بتاع `tenancy` بيتركّب هنا على pool
 * `eyadex_platform`، والـ port بتاع أول أدمن من `identity` (ADR-0006).
 */
@Module({
  imports: [
    AuthModule,
    AuthorizationCacheModule,
    IdentityModule,
    TenancyModule,
    PlatformDatabaseModule,
  ],
  controllers: [PlatformClinicsController, PlatformClinicAdminController],
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
    {
      provide: PLATFORM_CLINIC_CHANGES,
      inject: [PLATFORM_DATABASE, CLOCK],
      useFactory: (db: Database, clock: Clock) =>
        new PlatformClinicChanges({ db, clock, ids: systemUuidV7() }),
    },
    {
      // Read on the platform pool (eyadex_platform: SELECT on clinics, features, branches,
      // memberships, invitations; nothing on patients — PLAT-02).
      provide: PLATFORM_CLINIC_DETAIL,
      inject: [PLATFORM_DATABASE, CLOCK],
      useFactory: (db: Database, clock: Clock): ClinicDetailReader => {
        const reader = new PgClinicReader(db);
        const seats = new PgSeatUsageReader(db);
        return (clinicId) => getPlatformClinicDetail(reader, seats, clock, clinicId);
      },
    },
  ],
})
export class PlatformModule {}
