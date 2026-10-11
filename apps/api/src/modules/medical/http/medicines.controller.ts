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
  medicineInputSchema,
  type Medicine,
  type MedicineInput,
  type medicineListSchema,
} from "@eyadex/contracts/medicines";
import type { Database } from "@eyadex/db";
import type { z } from "zod";

import { DATABASE } from "../../../shared/database.provider.ts";
import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
// The one identity import a module may make: guards and request types (CLAUDE.architecture.md §2.2).
import { Require, RequiresFeature, type ClinicRequest } from "../../identity/index.ts";
import { MEDICINE_CHANGES } from "../ports/tokens.ts";
import { listMedicines } from "../queries/medicine-list.ts";
import type { MedicineChanges } from "../use-cases/medicine-changes/medicine-changes.ts";
import { actorOf, idOf, keyOf } from "./medical-request.ts";

type MedicineAnswer = { medicine: Medicine };

// P2-F2, R3-3. Thin: validate → call → map. The list is the clinic's, under the medical module; every
// write answers `{ medicine }`.
@Controller("medicines")
export class MedicinesController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(MEDICINE_CHANGES) private readonly changes: MedicineChanges,
  ) {}

  @Get()
  @Require("view:medicines:clinic")
  @RequiresFeature("medical")
  list(@Req() request: ClinicRequest): Promise<z.infer<typeof medicineListSchema>> {
    return listMedicines(this.db, request.clinicContext.clinicId);
  }

  @Post()
  @HttpCode(201)
  @Require("update:medicines:clinic")
  @RequiresFeature("medical")
  async create(
    @Req() request: ClinicRequest,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body(new ZodValidationPipe(medicineInputSchema)) body: MedicineInput,
  ): Promise<MedicineAnswer> {
    return { medicine: await this.changes.create(actorOf(request), body, keyOf(rawKey)) };
  }

  @Put(":id")
  @Require("update:medicines:clinic")
  @RequiresFeature("medical")
  async update(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(medicineInputSchema)) body: MedicineInput,
  ): Promise<MedicineAnswer> {
    return { medicine: await this.changes.update(actorOf(request), idOf(id), body) };
  }

  @Post(":id/deactivate")
  @HttpCode(200)
  @Require("update:medicines:clinic")
  @RequiresFeature("medical")
  async deactivate(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
  ): Promise<MedicineAnswer> {
    return { medicine: await this.changes.setStatus(actorOf(request), idOf(id), "inactive") };
  }

  @Post(":id/reactivate")
  @HttpCode(200)
  @Require("update:medicines:clinic")
  @RequiresFeature("medical")
  async reactivate(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
  ): Promise<MedicineAnswer> {
    return { medicine: await this.changes.setStatus(actorOf(request), idOf(id), "active") };
  }
}
