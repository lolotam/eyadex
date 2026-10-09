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
  Query,
  Req,
} from "@nestjs/common";
import { idSchema } from "@eyadex/contracts/common";
import { idempotencyKeySchema } from "@eyadex/contracts/onboarding";
import {
  serviceInputSchema,
  serviceListHttpQuerySchema,
  type ClinicService,
  type ServiceInput,
  type ServiceListHttpQuery,
  type ServiceListResponse,
} from "@eyadex/contracts/services";
import type { Database } from "@eyadex/db";

import { DATABASE } from "../../../shared/database.provider.ts";
import { ApiError } from "../../../shared/errors.ts";
import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
// The one identity import a module may make: guards and request types (CLAUDE.architecture.md §2.2).
import { Require, RequiresFeature, type ClinicRequest } from "../../identity/index.ts";
import { SERVICE_CHANGES } from "../ports/tokens.ts";
import { listServices } from "../queries/service-list.ts";
import type { ServiceActor, ServiceChanges } from "../use-cases/service-changes/service-changes.ts";

// A malformed id is an unknown service: 404, the same answer as another clinic's id (ISO-02).
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

const actorOf = (request: ClinicRequest): ServiceActor => ({
  clinicId: request.clinicContext.clinicId,
  userId: request.clinicContext.userId,
});

// D-12 (ADR-0026 §1). Thin: validate → call → map.
@Controller("services")
export class ServicesController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(SERVICE_CHANGES) private readonly changes: ServiceChanges,
  ) {}

  @Get()
  @Require("view:services:clinic")
  @RequiresFeature("appointments")
  list(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(serviceListHttpQuerySchema)) query: ServiceListHttpQuery,
  ): Promise<ServiceListResponse> {
    return listServices(this.db, request.clinicContext.clinicId, query);
  }

  @Post()
  @HttpCode(201)
  @Require("create:services:clinic")
  @RequiresFeature("appointments")
  create(
    @Req() request: ClinicRequest,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body(new ZodValidationPipe(serviceInputSchema)) body: ServiceInput,
  ): Promise<ClinicService> {
    return this.changes.create(actorOf(request), body, keyOf(rawKey));
  }

  @Put(":id")
  @Require("update:services:clinic")
  @RequiresFeature("appointments")
  update(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(serviceInputSchema)) body: ServiceInput,
  ): Promise<ClinicService> {
    return this.changes.update(actorOf(request), idOf(id), body);
  }

  @Post(":id/deactivate")
  @HttpCode(200)
  @Require("deactivate:services:clinic")
  @RequiresFeature("appointments")
  deactivate(@Req() request: ClinicRequest, @Param("id") id: string): Promise<ClinicService> {
    return this.changes.setStatus(actorOf(request), idOf(id), "inactive");
  }

  @Post(":id/reactivate")
  @HttpCode(200)
  @Require("deactivate:services:clinic")
  @RequiresFeature("appointments")
  reactivate(@Req() request: ClinicRequest, @Param("id") id: string): Promise<ClinicService> {
    return this.changes.setStatus(actorOf(request), idOf(id), "active");
  }
}
