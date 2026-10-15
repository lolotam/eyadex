import { Body, Controller, Get, Inject, Param, Patch, Req } from "@nestjs/common";
import { idSchema } from "@eyadex/contracts/common";
import {
  platformClinicFinanceRequestSchema,
  type PlatformClinicFinance,
  type PlatformClinicFinanceRequest,
  type platformFinanceTotalsSchema,
} from "@eyadex/contracts/finance";
import type { Database } from "@eyadex/db";
import type { z } from "zod";

import { ApiError } from "../../../shared/errors.ts";
import { PLATFORM_DATABASE } from "../../../shared/platform-database.ts";
import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
import { PlatformStaff, type AuthenticatedRequest } from "../../identity/index.ts";
import {
  readPlatformClinicFinance,
  readPlatformFinanceTotals,
  type PlatformClinicChanges,
} from "../../tenancy/index.ts";
import { PLATFORM_CLINIC_CHANGES } from "./platform-clinic-admin.controller.ts";

// A malformed id is an unknown clinic: 404, the same answer as a well-formed id that matches nothing.
const clinicIdOf = (raw: string): string => {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError("not_found");
  return parsed.data;
};

// Finance F1 (spec §8 rule 6, FIN-3). The currency and tax rate are the platform's to set; the totals come
// from finance_monthly_totals only, so the platform never reads an invoice row. Absolute values replay to
// the same state, so no Idempotency-Key.
@Controller("platform/clinics/:id")
export class PlatformClinicFinanceController {
  constructor(
    @Inject(PLATFORM_CLINIC_CHANGES) private readonly changes: PlatformClinicChanges,
    @Inject(PLATFORM_DATABASE) private readonly platformDb: Database,
  ) {}

  @Get("finance")
  @PlatformStaff()
  get(@Param("id") id: string): Promise<PlatformClinicFinance> {
    return this.answer(clinicIdOf(id));
  }

  @Patch("finance")
  @PlatformStaff()
  async update(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(platformClinicFinanceRequestSchema))
    body: PlatformClinicFinanceRequest,
  ): Promise<PlatformClinicFinance> {
    const clinicId = clinicIdOf(id);
    await this.changes.updateFinance(request.areaSession.session.user.id, clinicId, body);
    return this.answer(clinicId);
  }

  @Get("finance-totals")
  @PlatformStaff()
  async totals(@Param("id") id: string): Promise<z.infer<typeof platformFinanceTotalsSchema>> {
    const clinicId = clinicIdOf(id);
    await this.answer(clinicId);
    return readPlatformFinanceTotals(this.platformDb, clinicId);
  }

  private async answer(clinicId: string): Promise<PlatformClinicFinance> {
    const finance = await readPlatformClinicFinance(this.platformDb, clinicId);
    if (finance === null) throw new ApiError("not_found");
    return finance;
  }
}
