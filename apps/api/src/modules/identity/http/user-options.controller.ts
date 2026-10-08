import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import {
  optionListQuerySchema,
  type BranchOptionListResponse,
  type OptionListQuery,
  type RoleOptionListResponse,
} from "@eyadex/contracts/role-admin";
import type { Database } from "@eyadex/db";

import { DATABASE } from "../../../shared/database.provider.ts";
import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
import { Require } from "../access/access-rules.ts";
import type { ClinicRequest } from "../access/access.guard.ts";
import { listBranchOptions, listRoleOptions } from "../queries/user-options.ts";

// The user editor's pickers under the users key (ADR-0017, Codex on PR #46): an admin of users needs
// the names, not the right to read roles or branches.
@Controller("users")
export class UserOptionsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get("role-options")
  @Require("view:users:clinic")
  roleOptions(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(optionListQuerySchema)) query: OptionListQuery,
  ): Promise<RoleOptionListResponse> {
    return listRoleOptions(this.db, request.clinicContext.clinicId, query);
  }

  @Get("branch-options")
  @Require("view:users:clinic")
  branchOptions(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(optionListQuerySchema)) query: OptionListQuery,
  ): Promise<BranchOptionListResponse> {
    return listBranchOptions(this.db, request.clinicContext.clinicId, query);
  }
}
