import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import {
  roleListQuerySchema,
  type MeResponse,
  type PermissionCatalogueResponse,
  type RoleListQuery,
  type RoleListResponse,
} from "@eyadex/contracts/access";
import { PERMISSION_CATALOG } from "@eyadex/contracts/permissions";
import type { Database } from "@eyadex/db";

import { DATABASE } from "../../../shared/database.provider.ts";
import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
import { Authenticated, Require } from "../access/access-rules.ts";
import type { ClinicRequest } from "../access/access.guard.ts";
import { listRoles } from "../queries/list-roles.ts";

// Read-only routes that prove the guard (slice 4). Every check already ran in AccessGuard; these
// only shape the answer from the resolved context.

@Controller("me")
export class MeController {
  @Get()
  @Authenticated()
  me(@Req() request: ClinicRequest): MeResponse {
    const { member, context } = { member: request.clinicMember, context: request.clinicContext };
    return {
      user: {
        id: member.userId,
        fullName: member.fullName,
        email: member.email,
        preferredLanguage: member.preferredLanguage,
      },
      clinic: { id: member.clinicId, ...member.clinic },
      role: { id: member.role.id, nameAr: member.role.nameAr, nameEn: member.role.nameEn },
      permissions: [...context.permissions],
      allBranches: context.branchScope.all,
      branchIds: context.branchScope.all ? [] : [...context.branchScope.branchIds],
    };
  }
}

@Controller("permissions")
export class PermissionsController {
  @Get("catalogue")
  @Require("view:roles:clinic")
  catalogue(): PermissionCatalogueResponse {
    const modules = [...new Set(PERMISSION_CATALOG.map((p) => p.module))];
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
