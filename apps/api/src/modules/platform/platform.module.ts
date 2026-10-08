import { Module } from "@nestjs/common";
import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

import {
  PLATFORM_DATABASE,
  PlatformDatabaseModule,
  readPlatformConfig,
} from "../../shared/platform-database.ts";
import { SecretSealer } from "@eyadex/secrets";
import {
  AuthModule,
  AuthorizationCacheModule,
  IdentityModule,
  PgExclusiveMembers,
  PgSeatUsageReader,
  PlatformTeamModule,
} from "../identity/index.ts";
import {
  CLOCK,
  CreateClinicWithAdmin,
  FIRST_ADMIN_PROVISIONER,
  getPlatformClinicDetail,
  listPlatformClinics,
  PgClinicReader,
  PlatformClinicChanges,
  PlatformSettingsChanges,
  readPlatformOverview,
  readPlatformSettings,
  TenancyModule,
  type Clock,
  type FirstAdminProvisioner,
} from "../tenancy/index.ts";
import {
  PLATFORM_CLINIC_CHANGES,
  PLATFORM_CLINIC_DETAIL,
  PLATFORM_EXCLUSIVE_MEMBERS,
  PlatformClinicAdminController,
  type ClinicDetailReader,
} from "./http/platform-clinic-admin.controller.ts";
import {
  CREATE_CLINIC,
  PLATFORM_CLINIC_LIST,
  PlatformClinicsController,
  type ClinicListReader,
} from "./http/platform-clinics.controller.ts";
import {
  PLATFORM_OVERVIEW,
  PLATFORM_SETTINGS_CHANGES,
  PLATFORM_SETTINGS_READER,
  PlatformConsoleController,
  type OverviewReader,
  type SettingsReader,
} from "./http/platform-console.controller.ts";
import { PlatformTeamController } from "./http/platform-team.controller.ts";

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
    PlatformTeamModule,
  ],
  controllers: [
    PlatformClinicsController,
    PlatformClinicAdminController,
    PlatformConsoleController,
    PlatformTeamController,
  ],
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
    {
      provide: PLATFORM_CLINIC_LIST,
      inject: [PLATFORM_DATABASE, PLATFORM_CLINIC_DETAIL, CLOCK],
      useFactory:
        (db: Database, detail: ClinicDetailReader, clock: Clock): ClinicListReader =>
        (query) =>
          listPlatformClinics(db, detail, query, clock.now()),
    },
    {
      provide: PLATFORM_OVERVIEW,
      inject: [PLATFORM_DATABASE, CLOCK],
      useFactory:
        (db: Database, clock: Clock): OverviewReader =>
        () =>
          readPlatformOverview(db, clock),
    },
    {
      provide: PLATFORM_SETTINGS_READER,
      inject: [PLATFORM_DATABASE],
      useFactory:
        (db: Database): SettingsReader =>
        () =>
          readPlatformSettings(db),
    },
    {
      provide: PLATFORM_SETTINGS_CHANGES,
      inject: [PLATFORM_DATABASE, CLOCK],
      useFactory: (db: Database, clock: Clock) =>
        new PlatformSettingsChanges({ db, clock, ids: systemUuidV7() }),
    },
    // tenancy's port, implemented by identity, bound here like the seat reader above.
    { provide: PLATFORM_EXCLUSIVE_MEMBERS, useValue: new PgExclusiveMembers() },
  ],
  // The root AccessGuard asks the platform-account gate on every platform request (ADR-0020).
  exports: [PlatformTeamModule],
})
export class PlatformModule {}
