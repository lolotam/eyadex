import { Module, type DynamicModule } from "@nestjs/common";
import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

import { DatabaseModule } from "../../shared/database.module.ts";
import { DATABASE } from "../../shared/database.provider.ts";
import { CLOCK, TenancyModule, type Clock } from "../tenancy/index.ts";
import { PricesController } from "./http/prices.controller.ts";
import { PRICE_CHANGES } from "./ports/tokens.ts";
import { PriceChanges } from "./use-cases/prices/prices.ts";

/**
 * موديول المالية (finance F1): أسعار الخدمات، ومن بعدها الفواتير. كل الشغل على pool الـ `eyadex_app`
 * جوه `withTenant`، وكل مسار وراه `@RequiresFeature("finance")`؛ المنصة مالهاش أي مسار هنا.
 */
@Module({})
export class BillingModule {
  /**
   * الموديول بكل مساراته.
   *
   * @returns الموديول
   */
  static forRoot(): DynamicModule {
    return {
      module: BillingModule,
      imports: [DatabaseModule, TenancyModule],
      controllers: [PricesController],
      providers: [
        {
          provide: PRICE_CHANGES,
          inject: [DATABASE, CLOCK],
          useFactory: (db: Database, clock: Clock) =>
            new PriceChanges({ db, clock, ids: systemUuidV7() }),
        },
      ],
    };
  }
}
