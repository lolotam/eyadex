import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Patch,
  Put,
  Req,
  StreamableFile,
} from "@nestjs/common";
import {
  financeSettingsRequestSchema,
  invoicePrefixRequestSchema,
  paymentMethodsRequestSchema,
  paymentMethodsResponseSchema,
  type FinanceSettings,
  type InvoicePrefixItem,
} from "@eyadex/contracts/finance";
import type { z } from "zod";

import { ApiError } from "../../../shared/errors.ts";
import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
// The one identity import a module may make: guards and request types (CLAUDE.architecture.md §2.2).
import {
  Authenticated,
  Require,
  RequiresFeature,
  type ClinicRequest,
} from "../../identity/index.ts";
import { FINANCE_SETTINGS } from "../ports/tokens.ts";
import type { ClinicFinanceSettings } from "../use-cases/settings/settings.ts";
import { actorOf, idOf } from "./billing-request.ts";

// Spec §3.3, §8 rule 9. Thin: validate → call → map. The settings and the logo are read by any member
// once finance is on; changing them takes the clinic settings key, a prefix the branches key.
@Controller()
export class SettingsController {
  constructor(@Inject(FINANCE_SETTINGS) private readonly settings: ClinicFinanceSettings) {}

  @Get("clinic/settings/finance")
  @Authenticated()
  @RequiresFeature("finance")
  get(@Req() request: ClinicRequest): Promise<FinanceSettings> {
    return this.settings.get(request.clinicContext.clinicId);
  }

  @Patch("clinic/settings/finance")
  @Require("update:clinic_settings:clinic")
  @RequiresFeature("finance")
  update(
    @Req() request: ClinicRequest,
    @Body(new ZodValidationPipe(financeSettingsRequestSchema))
    body: z.infer<typeof financeSettingsRequestSchema>,
  ): Promise<FinanceSettings> {
    return this.settings.setCommercialRegNo(actorOf(request), body.commercialRegNo);
  }

  @Put("clinic/settings/payment-methods")
  @Require("update:clinic_settings:clinic")
  @RequiresFeature("finance")
  setPaymentMethods(
    @Req() request: ClinicRequest,
    @Body(new ZodValidationPipe(paymentMethodsRequestSchema))
    body: z.infer<typeof paymentMethodsRequestSchema>,
  ): Promise<z.infer<typeof paymentMethodsResponseSchema>> {
    return this.settings.setPaymentMethods(actorOf(request), body.paymentMethods);
  }

  @Put("clinic/logo")
  @Require("update:clinic_settings:clinic")
  @RequiresFeature("finance")
  setLogo(@Req() request: ClinicRequest, @Body() body: unknown): Promise<FinanceSettings> {
    // Only logo-upload.ts's parser yields a Buffer; any other body type is not an image.
    if (!Buffer.isBuffer(body)) {
      throw new ApiError("validation", [{ path: ["logo"], code: "invalid" }]);
    }
    return this.settings.setLogo(actorOf(request), body);
  }

  @Get("clinic/logo")
  @Header("cache-control", "private, no-store")
  @Authenticated()
  @RequiresFeature("finance")
  async logo(@Req() request: ClinicRequest): Promise<StreamableFile> {
    const logo = await this.settings.logo(request.clinicContext.clinicId);
    return new StreamableFile(logo.bytes, { type: logo.type, length: logo.bytes.length });
  }

  @Get("invoice-prefixes")
  @Require("update:branches:clinic")
  @RequiresFeature("finance")
  prefixes(@Req() request: ClinicRequest): Promise<{ items: InvoicePrefixItem[] }> {
    return this.settings.prefixes(request.clinicContext.clinicId);
  }

  @Put("invoice-prefixes/:branchId")
  @Require("update:branches:clinic")
  @RequiresFeature("finance")
  setPrefix(
    @Req() request: ClinicRequest,
    @Param("branchId") branchId: string,
    @Body(new ZodValidationPipe(invoicePrefixRequestSchema))
    body: z.infer<typeof invoicePrefixRequestSchema>,
  ): Promise<InvoicePrefixItem> {
    return this.settings.setPrefix(actorOf(request), idOf(branchId), body.invoicePrefix);
  }
}
