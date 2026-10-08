import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import { idSchema } from "@eyadex/contracts/common";
import { idempotencyKeySchema } from "@eyadex/contracts/onboarding";
import {
  patientInputSchema,
  type PatientDetail,
  type PatientInput,
  type PatientWriteResult,
} from "@eyadex/contracts/patients";
import {
  patientSearchRequestSchema,
  type PatientBranchOptionList,
  type PatientListResponse,
  type PatientSearchRequest,
} from "@eyadex/contracts/patients-api";
import type { PermissionAction } from "@eyadex/contracts/permissions";
import type { Database } from "@eyadex/db";

import { DATABASE } from "../../../shared/database.provider.ts";
import { ApiError } from "../../../shared/errors.ts";
import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
// The one identity import a module may make: guards and request types (CLAUDE.architecture.md §2.2).
import { Require, RequiresFeature, type ClinicRequest } from "../../identity/index.ts";
import { patientScopes } from "../domain/patient-rules.ts";
import type { PatientBranchReader } from "../ports/patient-branch-reader.ts";
import { OPEN_PATIENT, PATIENT_BRANCH_READER, PATIENT_CHANGES } from "../ports/tokens.ts";
import { patientBranchOptions } from "../queries/patient-branch-options.ts";
import { searchPatients } from "../queries/patient-views.ts";
import type { OpenPatient } from "../use-cases/open-patient/open-patient.ts";
import { requireScope, type PatientActor } from "../use-cases/patient-actor.ts";
import type { PatientChanges } from "../use-cases/patient-changes/patient-changes.ts";

// A malformed id is an unknown file: 404, the same answer as another clinic's id (ISO-02).
const idOf = (raw: string): string => {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError("not_found");
  return parsed.data;
};

const keyOf = (raw: string | undefined): string => {
  const key = idempotencyKeySchema.safeParse(raw);
  if (!key.success) {
    throw new ApiError("validation", [{ path: ["Idempotency-Key"], code: "required" }]);
  }
  return key.data;
};

const actorOf = (request: ClinicRequest): PatientActor => ({
  clinicId: request.clinicContext.clinicId,
  userId: request.clinicContext.userId,
  timezone: request.clinicMember.clinic.timezone,
  scopes: patientScopes(request.clinicContext.permissions, request.clinicContext.branchScope),
});

// Stories P1–P6 (ADR-0018). Thin: validate → call → map. No route ever takes personal data in its URL:
// the search term travels in a POST body, and `:id` is the opaque file id.
@Controller("patients")
export class PatientsController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(PATIENT_CHANGES) private readonly changes: PatientChanges,
    @Inject(OPEN_PATIENT) private readonly opener: OpenPatient,
    @Inject(PATIENT_BRANCH_READER) private readonly branches: PatientBranchReader,
  ) {}

  @Post("search")
  @HttpCode(200)
  @Require("view:patients:branch")
  @RequiresFeature("patients")
  search(
    @Req() request: ClinicRequest,
    @Body(new ZodValidationPipe(patientSearchRequestSchema)) body: PatientSearchRequest,
  ): Promise<PatientListResponse> {
    const actor = actorOf(request);
    const view = requireScope(actor.scopes.view);
    return searchPatients(
      this.db,
      this.branches,
      { ...actor, scopes: { ...actor.scopes, view } },
      body,
    );
  }

  @Get("branch-options/view")
  @Require("view:patients:branch")
  @RequiresFeature("patients")
  viewBranches(@Req() request: ClinicRequest): Promise<PatientBranchOptionList> {
    return this.options(request, "view");
  }

  @Get("branch-options/create")
  @Require("create:patients:branch")
  @RequiresFeature("patients")
  createBranches(@Req() request: ClinicRequest): Promise<PatientBranchOptionList> {
    return this.options(request, "create");
  }

  @Get("branch-options/update")
  @Require("update:patients:branch")
  @RequiresFeature("patients")
  updateBranches(@Req() request: ClinicRequest): Promise<PatientBranchOptionList> {
    return this.options(request, "update");
  }

  @Get(":id")
  @Require("view:patients:branch")
  @RequiresFeature("patients")
  open(@Req() request: ClinicRequest, @Param("id") id: string): Promise<PatientDetail> {
    return this.opener.open(actorOf(request), idOf(id));
  }

  @Post()
  @HttpCode(201)
  @Require("create:patients:branch")
  @RequiresFeature("patients")
  create(
    @Req() request: ClinicRequest,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body(new ZodValidationPipe(patientInputSchema)) body: PatientInput,
  ): Promise<PatientWriteResult> {
    return this.changes.create(actorOf(request), body, keyOf(rawKey));
  }

  @Put(":id")
  @Require("update:patients:branch")
  @RequiresFeature("patients")
  update(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(patientInputSchema)) body: PatientInput,
  ): Promise<PatientWriteResult> {
    return this.changes.update(actorOf(request), idOf(id), body);
  }

  @Post(":id/archive")
  @HttpCode(200)
  @Require("deactivate:patients:branch")
  @RequiresFeature("patients")
  archive(@Req() request: ClinicRequest, @Param("id") id: string): Promise<PatientWriteResult> {
    return this.changes.setStatus(actorOf(request), idOf(id), "archived");
  }

  @Post(":id/restore")
  @HttpCode(200)
  @Require("deactivate:patients:branch")
  @RequiresFeature("patients")
  restore(@Req() request: ClinicRequest, @Param("id") id: string): Promise<PatientWriteResult> {
    return this.changes.setStatus(actorOf(request), idOf(id), "active");
  }

  private options(
    request: ClinicRequest,
    action: Exclude<PermissionAction, "deactivate">,
  ): Promise<PatientBranchOptionList> {
    const actor = actorOf(request);
    const scope = requireScope(actor.scopes[action]);
    return patientBranchOptions(
      this.db,
      this.branches,
      actor.clinicId,
      scope,
      request.clinicMember.preferredLanguage,
    );
  }
}
