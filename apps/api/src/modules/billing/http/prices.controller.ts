import { Body, Controller, Get, Inject, Param, Patch, Put, Req } from "@nestjs/common";
import {
  providerPricesRequestSchema,
  servicePriceRequestSchema,
  type PriceList,
  type ServicePrice,
} from "@eyadex/contracts/finance";
import type { z } from "zod";

import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
// The one identity import a module may make: guards and request types (CLAUDE.architecture.md §2.2).
import { Require, RequiresFeature, type ClinicRequest } from "../../identity/index.ts";
import { PRICE_CHANGES } from "../ports/tokens.ts";
import type { PriceChanges } from "../use-cases/prices/prices.ts";
import { actorOf, idOf } from "./billing-request.ts";

type PriceAnswer = { servicePrice: ServicePrice };

// FIN-A8, R1-13. Thin: validate → call → map. Prices live on their own routes, so `GET /v1/services`
// (appointments) never carries one.
@Controller()
export class PricesController {
  constructor(@Inject(PRICE_CHANGES) private readonly prices: PriceChanges) {}

  @Get("prices")
  @Require("view:prices:clinic")
  @RequiresFeature("finance")
  list(@Req() request: ClinicRequest): Promise<PriceList> {
    return this.prices.list(request.clinicContext.clinicId);
  }

  @Patch("services/:id/price")
  @Require("update:prices:clinic")
  @RequiresFeature("finance")
  async setPrice(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(servicePriceRequestSchema))
    body: z.infer<typeof servicePriceRequestSchema>,
  ): Promise<PriceAnswer> {
    const servicePrice = await this.prices.setServicePrice(
      actorOf(request),
      idOf(id),
      body.priceMinor,
    );
    return { servicePrice };
  }

  @Put("services/:id/provider-prices")
  @Require("update:prices:clinic")
  @RequiresFeature("finance")
  async setProviderPrices(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(providerPricesRequestSchema))
    body: z.infer<typeof providerPricesRequestSchema>,
  ): Promise<PriceAnswer> {
    const servicePrice = await this.prices.replaceProviderPrices(
      actorOf(request),
      idOf(id),
      body.items,
    );
    return { servicePrice };
  }
}
