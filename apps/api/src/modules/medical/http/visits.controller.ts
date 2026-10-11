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
import {
  visitAddendumInputSchema,
  visitCancelSchema,
  visitDiagnosesInputSchema,
  visitNoteInputSchema,
  visitPrescriptionInputSchema,
  visitStartSchema,
  walkInSearchSchema,
  type VisitDetail,
  type PrescriptionPrint,
  type VisitNoteInput,
  type VisitStartInput,
  type WalkInCandidates,
  type WalkInSearchInput,
  type walkInBranchesSchema,
} from "@eyadex/contracts/visits";
import type { z } from "zod";

import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
// The one identity import a module may make: guards and request types (CLAUDE.architecture.md §2.2).
import { Require, RequiresFeature, type ClinicRequest } from "../../identity/index.ts";
import {
  PRESCRIPTION_PRINTS,
  START_VISIT,
  VISIT_LIFECYCLE,
  VISIT_LISTS,
  VISIT_READS,
} from "../ports/tokens.ts";
import type { PrescriptionPrints } from "../use-cases/prescription-print/prescription-print.ts";
import type { StartVisit, VisitWriteResponse } from "../use-cases/start-visit/start-visit.ts";
import type { VisitLifecycle } from "../use-cases/visit-lifecycle/visit-lifecycle.ts";
import type { VisitLists } from "../use-cases/visit-lists/visit-lists.ts";
import type { VisitReads } from "../use-cases/visit-reads/visit-reads.ts";
import { actorOf, idOf, keyOf } from "./medical-request.ts";

type VisitCancelInput = z.infer<typeof visitCancelSchema>;
type VisitAddendumInput = z.infer<typeof visitAddendumInputSchema>;
type WalkInBranches = z.infer<typeof walkInBranchesSchema>;
type DiagnosesInput = z.infer<typeof visitDiagnosesInputSchema>;
type PrescriptionInput = z.infer<typeof visitPrescriptionInputSchema>;

// Spec §5, ADR-0029. Thin: validate → call → map. Every route needs the module. The reads admit `own`
// (the guard's grantFor still reports a wider key held) and the use cases narrow it; the writes need
// `update:medical:*` and the use cases add the provider rule (P2-3).
@Controller("visits")
export class VisitsController {
  constructor(
    @Inject(START_VISIT) private readonly starts: StartVisit,
    @Inject(VISIT_LIFECYCLE) private readonly lifecycle: VisitLifecycle,
    @Inject(VISIT_READS) private readonly reads: VisitReads,
    @Inject(VISIT_LISTS) private readonly lists: VisitLists,
    @Inject(PRESCRIPTION_PRINTS) private readonly prints: PrescriptionPrints,
  ) {}

  @Get("walk-in-branches")
  @Require("create:visits:own")
  @RequiresFeature("medical")
  walkInBranches(@Req() request: ClinicRequest): Promise<WalkInBranches> {
    return this.reads.walkInBranches(actorOf(request));
  }

  // R3-1: the name or file number travels in the body, never the URL.
  @Post("walk-in-candidates")
  @HttpCode(200)
  @Require("create:visits:own")
  @RequiresFeature("medical")
  walkInCandidates(
    @Req() request: ClinicRequest,
    @Body(new ZodValidationPipe(walkInSearchSchema)) body: WalkInSearchInput,
  ): Promise<WalkInCandidates> {
    return this.reads.walkInCandidates(actorOf(request), body);
  }

  @Post()
  @HttpCode(201)
  @Require("create:visits:own")
  @RequiresFeature("medical")
  start(
    @Req() request: ClinicRequest,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body(new ZodValidationPipe(visitStartSchema)) body: VisitStartInput,
  ): Promise<VisitWriteResponse> {
    return this.starts.start(actorOf(request), body, keyOf(rawKey));
  }

  @Get(":id")
  @Require("view:visits:own")
  @RequiresFeature("medical")
  open(@Req() request: ClinicRequest, @Param("id") id: string): Promise<VisitDetail> {
    return this.reads.open(actorOf(request), idOf(id));
  }

  @Put(":id/note")
  @Require("update:medical:own")
  @RequiresFeature("medical")
  saveNote(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(visitNoteInputSchema)) body: VisitNoteInput,
  ): Promise<VisitWriteResponse> {
    return this.lifecycle.saveNote(actorOf(request), idOf(id), body);
  }

  @Post(":id/sign")
  @HttpCode(200)
  @Require("update:medical:own")
  @RequiresFeature("medical")
  sign(@Req() request: ClinicRequest, @Param("id") id: string): Promise<VisitWriteResponse> {
    return this.lifecycle.sign(actorOf(request), idOf(id));
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @Require("update:medical:own")
  @RequiresFeature("medical")
  cancel(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(visitCancelSchema)) body: VisitCancelInput,
  ): Promise<VisitWriteResponse> {
    return this.lifecycle.cancel(actorOf(request), idOf(id), body);
  }

  @Post(":id/addenda")
  @HttpCode(201)
  @Require("update:medical:own")
  @RequiresFeature("medical")
  addAddendum(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(visitAddendumInputSchema)) body: VisitAddendumInput,
  ): Promise<VisitWriteResponse> {
    return this.lifecycle.addAddendum(actorOf(request), idOf(id), body);
  }

  // P2-8, P2-9, R1-13: each list is replaced whole on a draft.
  @Put(":id/diagnoses")
  @Require("update:medical:own")
  @RequiresFeature("medical")
  saveDiagnoses(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(visitDiagnosesInputSchema)) body: DiagnosesInput,
  ): Promise<VisitWriteResponse> {
    return this.lists.saveDiagnoses(actorOf(request), idOf(id), body);
  }

  @Put(":id/prescription")
  @Require("update:medical:own")
  @RequiresFeature("medical")
  savePrescription(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(visitPrescriptionInputSchema)) body: PrescriptionInput,
  ): Promise<VisitWriteResponse> {
    return this.lists.savePrescription(actorOf(request), idOf(id), body);
  }

  @Get(":id/prescription/print")
  @Require("view:medical:own")
  @RequiresFeature("medical")
  printPrescription(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
  ): Promise<PrescriptionPrint> {
    return this.prints.print(actorOf(request), idOf(id));
  }
}
