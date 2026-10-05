import { Body, Controller, Headers, HttpCode, Inject, Post, Req, UseGuards } from "@nestjs/common";
import {
  createClinicRequestSchema,
  idempotencyKeySchema,
  type CreateClinicRequest,
  type CreateClinicResponse,
} from "@eyadex/contracts/onboarding";

import { ApiError } from "../../../shared/errors.ts";
import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
import {
  PlatformAreaGuard,
  SessionGuard,
  type AuthenticatedRequest,
} from "../../identity/index.ts";
import type { CreateClinicWithAdmin } from "../../tenancy/index.ts";

export const CREATE_CLINIC = Symbol("platform.CreateClinicWithAdmin");

// Platform host first (anything else → 404), then a platform session with a verified second factor.
// TODO(spec): @Require("create:clinics:platform") when the platform permission catalogue lands (slice 4).
@Controller("platform/clinics")
@UseGuards(PlatformAreaGuard, SessionGuard)
export class PlatformClinicsController {
  constructor(@Inject(CREATE_CLINIC) private readonly createClinic: CreateClinicWithAdmin) {}

  @Post()
  @HttpCode(201)
  async create(
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body(new ZodValidationPipe(createClinicRequestSchema)) input: CreateClinicRequest,
  ): Promise<CreateClinicResponse> {
    const key = idempotencyKeySchema.safeParse(rawKey);
    if (!key.success) {
      throw new ApiError("validation", [{ path: ["Idempotency-Key"], code: "required" }]);
    }
    return this.createClinic.execute({
      actorUserId: request.areaSession.session.user.id,
      idempotencyKey: key.data,
      input,
    });
  }
}
