import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Param,
  Patch,
  Put,
  Req,
} from "@nestjs/common";
import { idSchema } from "@eyadex/contracts/common";
import { idempotencyKeySchema } from "@eyadex/contracts/onboarding";
import {
  featureModuleParamSchema,
  setFeatureRequestSchema,
  updateLimitsRequestSchema,
  updateSubscriptionRequestSchema,
  type PlatformClinicDetail,
  type SetFeatureRequest,
  type UpdateLimitsRequest,
  type UpdateSubscriptionRequest,
} from "@eyadex/contracts/platform-clinics";

import { ApiError } from "../../../shared/errors.ts";
import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
import {
  AUTHORIZATION_INVALIDATOR,
  PlatformStaff,
  type AuthenticatedRequest,
  type AuthorizationInvalidator,
} from "../../identity/index.ts";
import type { PlatformClinicChanges } from "../../tenancy/index.ts";

export const PLATFORM_CLINIC_CHANGES = Symbol("platform.PlatformClinicChanges");
export const PLATFORM_CLINIC_DETAIL = Symbol("platform.ClinicDetail");

/** يقرا تفاصيل عيادة على pool المنصة؛ `null` = مش موجودة. */
export type ClinicDetailReader = (clinicId: string) => Promise<PlatformClinicDetail | null>;

const logger = new Logger("platform-clinics");

// A malformed id is an unknown clinic: 404, the same answer as a well-formed id that matches nothing.
const clinicIdOf = (raw: string): string => {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError("not_found");
  return parsed.data;
};

// Stories 9–15 and 18 (ADR-0010). PUT/PATCH with absolute values replay to the same state, so no
// Idempotency-Key; `durationDays` is relative and needs one. Each write invalidates the cache after commit.
@Controller("platform/clinics/:id")
export class PlatformClinicAdminController {
  constructor(
    @Inject(PLATFORM_CLINIC_CHANGES) private readonly changes: PlatformClinicChanges,
    @Inject(PLATFORM_CLINIC_DETAIL) private readonly detail: ClinicDetailReader,
    @Inject(AUTHORIZATION_INVALIDATOR) private readonly invalidator: AuthorizationInvalidator,
  ) {}

  @Get()
  @PlatformStaff()
  read(@Param("id") id: string): Promise<PlatformClinicDetail> {
    return this.answer(clinicIdOf(id));
  }

  @Put("features/:module")
  @HttpCode(200)
  @PlatformStaff()
  async setFeature(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("module") rawModule: string,
    @Body(new ZodValidationPipe(setFeatureRequestSchema)) body: SetFeatureRequest,
  ): Promise<PlatformClinicDetail> {
    const clinicId = clinicIdOf(id);
    const module = featureModuleParamSchema.safeParse(rawModule);
    if (!module.success) throw new ApiError("not_found");
    await this.changes.setFeature(actor(request), clinicId, module.data, body.enabled);
    return this.changed(clinicId);
  }

  @Patch("subscription")
  @PlatformStaff()
  async subscription(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body(new ZodValidationPipe(updateSubscriptionRequestSchema)) body: UpdateSubscriptionRequest,
  ): Promise<PlatformClinicDetail> {
    const clinicId = clinicIdOf(id);
    // `durationDays` counts from the request time, so a retry would extend twice: it needs a key.
    const key = rawKey === undefined ? undefined : idempotencyKeySchema.safeParse(rawKey);
    if (key?.success === false || (key === undefined && body.durationDays !== undefined)) {
      throw new ApiError("validation", [{ path: ["Idempotency-Key"], code: "required" }]);
    }
    await this.changes.updateSubscription(actor(request), clinicId, body, key?.data);
    return this.changed(clinicId);
  }

  @Patch("limits")
  @PlatformStaff()
  async limits(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateLimitsRequestSchema)) body: UpdateLimitsRequest,
  ): Promise<PlatformClinicDetail> {
    const clinicId = clinicIdOf(id);
    await this.changes.updateLimits(actor(request), clinicId, body);
    return this.changed(clinicId);
  }

  private async changed(clinicId: string): Promise<PlatformClinicDetail> {
    try {
      await this.invalidator.clinicChanged(clinicId);
    } catch {
      // Committed already; the stale snapshot lives at most MEMBER_TTL_SECONDS (ADR-0009/0010).
      logger.warn("authorization cache invalidation failed; relying on the 30 s TTL");
    }
    return this.answer(clinicId);
  }

  private async answer(clinicId: string): Promise<PlatformClinicDetail> {
    const detail = await this.detail(clinicId);
    if (detail === null) throw new ApiError("not_found");
    return detail;
  }
}

const actor = (request: AuthenticatedRequest) => request.areaSession.session.user.id;
