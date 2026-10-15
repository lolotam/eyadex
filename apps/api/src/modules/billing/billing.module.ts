import { Module, type DynamicModule } from "@nestjs/common";
import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

import { DatabaseModule } from "../../shared/database.module.ts";
import { DATABASE } from "../../shared/database.provider.ts";
// A module.ts may bind another module's adapter to a port it owns (CLAUDE.architecture.md §2.2).
import { PgBillingAppointments } from "../appointments/index.ts";
import { PgBillingVisits } from "../medical/index.ts";
import { CLOCK, TenancyModule, type Clock } from "../tenancy/index.ts";
import { InvoicesController } from "./http/invoices.controller.ts";
import { PricesController } from "./http/prices.controller.ts";
import type { BillingAppointmentReader, BillingVisitReader } from "./ports/billing-sources.ts";
import { INVOICE_DRAFTS, PRICE_CHANGES } from "./ports/tokens.ts";
import { InvoiceDrafts } from "./use-cases/draft/draft.ts";
import { PriceChanges } from "./use-cases/prices/prices.ts";

// Typed against the module's own ports, so no adapter can drift from what the module needs.
const sources = {
  appointments: new PgBillingAppointments() satisfies BillingAppointmentReader,
  visits: new PgBillingVisits() satisfies BillingVisitReader,
};

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
      controllers: [PricesController, InvoicesController],
      providers: [
        {
          provide: PRICE_CHANGES,
          inject: [DATABASE, CLOCK],
          useFactory: (db: Database, clock: Clock) =>
            new PriceChanges({ db, clock, ids: systemUuidV7() }),
        },
        {
          provide: INVOICE_DRAFTS,
          inject: [DATABASE],
          useFactory: (db: Database) => new InvoiceDrafts({ db, sources }),
        },
      ],
    };
  }
}
