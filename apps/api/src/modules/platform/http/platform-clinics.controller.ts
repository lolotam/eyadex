import { Body, Controller, Get, Headers, HttpCode, Inject, Post, Query, Req } from "@nestjs/common";
import {
  platformClinicListQuerySchema,
  type PlatformClinicListQuery,
  type PlatformClinicListResponse,
} from "@eyadex/contracts/platform-clinics";
import {
  createClinicRequestSchema,
  idempotencyKeySchema,
  type CreateClinicRequest,
  type CreateClinicResponse,
} from "@eyadex/contracts/onboarding";

import { ApiError } from "../../../shared/errors.ts";
import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
import { PlatformStaff, type AuthenticatedRequest } from "../../identity/index.ts";
import type { CreateClinicWithAdmin } from "../../tenancy/index.ts";

export const CREATE_CLINIC = Symbol("platform.CreateClinicWithAdmin");
export const PLATFORM_CLINIC_LIST = Symbol("platform.ClinicList");

/** يقرا صفحة من قايمة العيادات على pool المنصة. */
export type ClinicListReader = (
  query: PlatformClinicListQuery,
) => Promise<PlatformClinicListResponse>;

// Platform host first (anything else → 404), then a platform session with a verified second factor —
// all in the global AccessGuard. No roles inside the platform team in the MVP (PRD §7).
@Controller("platform/clinics")
export class PlatformClinicsController {
  constructor(
    @Inject(CREATE_CLINIC) private readonly createClinic: CreateClinicWithAdmin,
    @Inject(PLATFORM_CLINIC_LIST) private readonly clinics: ClinicListReader,
  ) {}

  // Story 18 list (ADR-0016): every item is the strict detail shape, never a patient field.
  @Get()
  @PlatformStaff()
  list(
    @Query(new ZodValidationPipe(platformClinicListQuerySchema)) query: PlatformClinicListQuery,
  ): Promise<PlatformClinicListResponse> {
    return this.clinics(query);
  }

  @Post()
  @HttpCode(201)
  @PlatformStaff()
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
