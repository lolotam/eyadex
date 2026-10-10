import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req } from "@nestjs/common";
import { idSchema } from "@eyadex/contracts/common";
import {
  branchScheduleInputSchema,
  timeOffInputSchema,
  type BranchScheduleInput,
  type ProviderListResponse,
  type ProviderSchedule,
  type ScheduleWriteResponse,
  type TimeOffInput,
} from "@eyadex/contracts/schedules";
import type { Database } from "@eyadex/db";

import { DATABASE } from "../../../shared/database.provider.ts";
import { ApiError } from "../../../shared/errors.ts";
import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
// The one identity import a module may make: guards and request types (CLAUDE.architecture.md §2.2).
import { Require, RequiresFeature, type ClinicRequest } from "../../identity/index.ts";
import { CLOCK, type Clock } from "../../tenancy/index.ts";
import { reachOf, viewReachOf } from "../domain/scheduling-scope.ts";
import type { ProviderDirectory } from "../ports/provider-directory.ts";
import type { SchedulingBranchReader } from "../ports/scheduling-branch-reader.ts";
import { PROVIDER_DIRECTORY, SCHEDULE_CHANGES, SCHEDULING_BRANCH_READER } from "../ports/tokens.ts";
import { listProviders, readSchedule, type ScheduleViewer } from "../queries/provider-schedule.ts";
import type {
  ScheduleActor,
  ScheduleChanges,
} from "../use-cases/schedule-changes/schedule-changes.ts";

// A malformed id is an unknown record: 404, the same answer as another clinic's id (ISO-02).
const idOf = (raw: string): string => {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError("not_found");
  return parsed.data;
};

// The reach of the route's own action: its clinic key = every branch, its branch key = the member's.
const viewerOf = (request: ClinicRequest): ScheduleViewer => {
  const reach = reachOf(request.permissionGrant, request.clinicContext.branchScope);
  if (reach === null) throw new ApiError("forbidden");
  return {
    clinicId: request.clinicContext.clinicId,
    reach,
    language: request.clinicMember.preferredLanguage,
  };
};

const actorOf = (request: ClinicRequest): ScheduleActor => ({
  ...viewerOf(request),
  userId: request.clinicContext.userId,
  viewReach: viewReachOf(request.clinicContext.permissions, request.clinicContext.branchScope),
});

// D-6, D-13, D-14 (ADR-0026 §3–§4). Thin: validate → call → map.
@Controller("schedules")
export class SchedulesController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(SCHEDULE_CHANGES) private readonly changes: ScheduleChanges,
    @Inject(PROVIDER_DIRECTORY) private readonly providers: ProviderDirectory,
    @Inject(SCHEDULING_BRANCH_READER) private readonly branches: SchedulingBranchReader,
  ) {}

  @Get("providers")
  @Require("view:schedules:branch")
  @RequiresFeature("appointments")
  list(@Req() request: ClinicRequest): Promise<ProviderListResponse> {
    return listProviders(this.db, this.providers, viewerOf(request));
  }

  @Get(":membershipId")
  @Require("view:schedules:branch")
  @RequiresFeature("appointments")
  read(
    @Req() request: ClinicRequest,
    @Param("membershipId") membershipId: string,
  ): Promise<ProviderSchedule> {
    const viewer = viewerOf(request);
    return readSchedule(
      this.db,
      this.providers,
      this.branches,
      viewer,
      idOf(membershipId),
      this.clock.now(),
    );
  }

  @Put(":membershipId/branches/:branchId")
  @Require("update:schedules:branch")
  @RequiresFeature("appointments")
  replace(
    @Req() request: ClinicRequest,
    @Param("membershipId") membershipId: string,
    @Param("branchId") branchId: string,
    @Body(new ZodValidationPipe(branchScheduleInputSchema)) body: BranchScheduleInput,
  ): Promise<ScheduleWriteResponse> {
    return this.changes.replaceBranch(
      actorOf(request),
      idOf(membershipId),
      idOf(branchId),
      body.shifts,
    );
  }

  @Post(":membershipId/time-off")
  @HttpCode(201)
  @Require("update:schedules:clinic")
  @RequiresFeature("appointments")
  addTimeOff(
    @Req() request: ClinicRequest,
    @Param("membershipId") membershipId: string,
    @Body(new ZodValidationPipe(timeOffInputSchema)) body: TimeOffInput,
  ): Promise<ScheduleWriteResponse> {
    return this.changes.addTimeOff(actorOf(request), idOf(membershipId), body);
  }

  @Post(":membershipId/time-off/:timeOffId/cancel")
  @HttpCode(200)
  @Require("update:schedules:clinic")
  @RequiresFeature("appointments")
  cancelTimeOff(
    @Req() request: ClinicRequest,
    @Param("membershipId") membershipId: string,
    @Param("timeOffId") timeOffId: string,
  ): Promise<ScheduleWriteResponse> {
    return this.changes.cancelTimeOff(actorOf(request), idOf(membershipId), idOf(timeOffId));
  }
}
