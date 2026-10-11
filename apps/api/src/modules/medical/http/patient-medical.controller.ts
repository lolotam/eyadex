import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import {
  medicalProfileInputSchema,
  type MedicalProfile,
  type MedicalProfileInput,
} from "@eyadex/contracts/medical-profile";
import {
  visitListQuerySchema,
  visitSearchSchema,
  type VisitList,
  type VisitSearchInput,
} from "@eyadex/contracts/visits";
import type { z } from "zod";

import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
// The one identity import a module may make: guards and request types (CLAUDE.architecture.md §2.2).
import { Require, RequiresFeature, type ClinicRequest } from "../../identity/index.ts";
import { MEDICAL_PROFILE_CHANGES, VISIT_READS } from "../ports/tokens.ts";
import type { MedicalProfileChanges } from "../use-cases/medical-profile/medical-profile.ts";
import type { VisitReads } from "../use-cases/visit-reads/visit-reads.ts";
import { actorOf, idOf } from "./medical-request.ts";

type VisitListQuery = z.infer<typeof visitListQuerySchema>;

// Spec §5: a patient's visits and medical file, under /v1/patients/:id beside the patients module's own
// routes. Nothing clinical travels in a URL: the note search is a POST body (R2-1).
@Controller("patients")
export class PatientMedicalController {
  constructor(
    @Inject(VISIT_READS) private readonly reads: VisitReads,
    @Inject(MEDICAL_PROFILE_CHANGES) private readonly profiles: MedicalProfileChanges,
  ) {}

  @Get(":id/visits")
  @Require("view:visits:own")
  @RequiresFeature("medical")
  visits(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Query(new ZodValidationPipe(visitListQuerySchema)) query: VisitListQuery,
  ): Promise<VisitList> {
    return this.reads.list(actorOf(request), idOf(id), query.cursor);
  }

  @Post(":id/visits/search")
  @HttpCode(200)
  @Require("view:medical:own")
  @RequiresFeature("medical")
  search(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(visitSearchSchema)) body: VisitSearchInput,
  ): Promise<VisitList> {
    return this.reads.search(actorOf(request), idOf(id), body);
  }

  @Get(":id/medical-profile")
  @Require("view:medical:own")
  @RequiresFeature("medical")
  profile(@Req() request: ClinicRequest, @Param("id") id: string): Promise<MedicalProfile> {
    return this.profiles.open(actorOf(request), idOf(id));
  }

  @Put(":id/medical-profile")
  @Require("update:medical:own")
  @RequiresFeature("medical")
  saveProfile(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(medicalProfileInputSchema)) body: MedicalProfileInput,
  ): Promise<MedicalProfile> {
    return this.profiles.save(actorOf(request), idOf(id), body);
  }
}
