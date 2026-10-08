import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import {
  roleListQuerySchema,
  type MeResponse,
  type PermissionCatalogueResponse,
  type RoleListQuery,
  type RoleListResponse,
} from "@eyadex/contracts/access";
import { PERMISSION_CATALOG } from "@eyadex/contracts/permissions";
import { expiryAlertDays } from "@eyadex/contracts/platform";
import type { Database } from "@eyadex/db";

import { DATABASE } from "../../../shared/database.provider.ts";
import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
import { CLOCK, type Clock } from "../../tenancy/index.ts";
import { Authenticated, Require } from "../access/access-rules.ts";
import type { ClinicRequest } from "../access/access.guard.ts";
import { listRoles } from "../queries/list-roles.ts";

/** أيام نافذة تنبيه الانتهاء من إعدادات المنصة (0036، ADR-0020). */
export type ExpiryAlertWindow = () => Promise<number>;
export const EXPIRY_ALERT_WINDOW = Symbol("identity.ExpiryAlertWindow");

// Read-only routes that prove the guard (slice 4). Every check already ran in AccessGuard; these
// only shape the answer from the resolved context.

@Controller("me")
export class MeController {
  constructor(
    @Inject(EXPIRY_ALERT_WINDOW) private readonly alertWindow: ExpiryAlertWindow,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get()
  @Authenticated()
  async me(@Req() request: ClinicRequest): Promise<MeResponse> {
    const { member, context } = { member: request.clinicMember, context: request.clinicContext };
    // Story 30: the banner window is the platform's setting, counted on the API clock (ADR-0020).
    const expiresInDays = expiryAlertDays(
      member.clinic.expiresAt,
      await this.alertWindow(),
      this.clock.now().getTime(),
    );
    return {
      user: {
        id: member.userId,
        fullName: member.fullName,
        email: member.email,
        preferredLanguage: member.preferredLanguage,
      },
      // Named fields, not a spread: the snapshot also carries enabledModules, which `modules` answers.
      clinic: {
        id: member.clinicId,
        nameAr: member.clinic.nameAr,
        nameEn: member.clinic.nameEn,
        timezone: member.clinic.timezone,
        status: member.clinic.status,
        expiresAt: member.clinic.expiresAt,
      },
      role: { id: member.role.id, nameAr: member.role.nameAr, nameEn: member.role.nameEn },
      permissions: [...context.permissions],
      allBranches: context.branchScope.all,
      branchIds: context.branchScope.all ? [] : [...context.branchScope.branchIds],
      modules: [...context.enabledModules],
      expiresInDays,
    };
  }
}

@Controller("permissions")
export class PermissionsController {
  @Get("catalogue")
  @Require("view:roles:clinic")
  catalogue(@Req() request: ClinicRequest): PermissionCatalogueResponse {
    // A locked module disappears from the role editor (PRD §4.8); its role rows stay (FLAG-02).
    const enabled = request.clinicContext.enabledModules;
    const modules = [...new Set(PERMISSION_CATALOG.map((p) => p.module))].filter(
      (module) => module === null || enabled.includes(module),
    );
    return {
      modules: modules.map((module) => ({
        module,
        permissions: PERMISSION_CATALOG.filter((p) => p.module === module).map(
          ({ key, action, resource, scope }) => ({ key, action, resource, scope }),
        ),
      })),
    };
  }
}

@Controller("roles")
export class RolesController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  @Require("view:roles:clinic")
  list(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(roleListQuerySchema)) query: RoleListQuery,
  ): Promise<RoleListResponse> {
    return listRoles(this.db, request.clinicContext.clinicId, query);
  }
}
