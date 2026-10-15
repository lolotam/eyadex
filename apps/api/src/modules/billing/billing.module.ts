import { Module, type DynamicModule } from "@nestjs/common";
import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

import { blobStoreFromEnv } from "../../shared/blob/blob-store-config.ts";
import type { BlobStore } from "../../shared/blob/blob-store.ts";
import { DatabaseModule } from "../../shared/database.module.ts";
import { DATABASE } from "../../shared/database.provider.ts";
// A module.ts may bind another module's adapter to a port it owns (CLAUDE.architecture.md §2.2).
import { PgBillingAppointments } from "../appointments/index.ts";
import { PgBillingVisits } from "../medical/index.ts";
import { PgBillingPatients } from "../patients/index.ts";
import { CLOCK, TenancyModule, type Clock } from "../tenancy/index.ts";
import { InvoicesController } from "./http/invoices.controller.ts";
import { PricesController } from "./http/prices.controller.ts";
import { SettingsController } from "./http/settings.controller.ts";
import type { BillingPatientReader } from "./ports/billing-patients.ts";
import type { BillingAppointmentReader, BillingVisitReader } from "./ports/billing-sources.ts";
import {
  INVOICE_CHANGES,
  INVOICE_DRAFTS,
  INVOICE_ISSUES,
  INVOICE_READS,
  FINANCE_SETTINGS,
  PRICE_CHANGES,
} from "./ports/tokens.ts";
import { ClinicFinanceSettings } from "./use-cases/settings/settings.ts";
import { InvoiceChanges } from "./use-cases/changes/changes.ts";
import { InvoiceDrafts } from "./use-cases/draft/draft.ts";
import { InvoiceIssues } from "./use-cases/issue/issue.ts";
import { InvoiceReads } from "./use-cases/reads/reads.ts";
import { PriceChanges } from "./use-cases/prices/prices.ts";

// Typed against the module's own ports, so no adapter can drift from what the module needs.
const sources = {
  appointments: new PgBillingAppointments() satisfies BillingAppointmentReader,
  visits: new PgBillingVisits() satisfies BillingVisitReader,
};
const patients: BillingPatientReader = new PgBillingPatients();

/**
 * موديول المالية (finance F1): أسعار الخدمات، ومن بعدها الفواتير. كل الشغل على pool الـ `eyadex_app`
 * جوه `withTenant`، وكل مسار وراه `@RequiresFeature("finance")`؛ المنصة مالهاش أي مسار هنا.
 */
@Module({})
export class BillingModule {
  /**
   * الموديول بمخزن اللوجو: اللي الاختبار بيديه، وإلا الـ bucket الخاص من البيئة (`MEDICAL_BLOB_S3_*`)، وإلا
   * مخزن مش متظبّط بيرد 503 على رفع اللوجو وقرايته بس.
   *
   * @param blobStore مخزن بديل (الاختبارات بس)
   * @returns الموديول
   */
  static forRoot(blobStore?: BlobStore): DynamicModule {
    return {
      module: BillingModule,
      imports: [DatabaseModule, TenancyModule],
      controllers: [PricesController, InvoicesController, SettingsController],
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
        {
          provide: INVOICE_ISSUES,
          inject: [DATABASE, CLOCK],
          useFactory: (db: Database, clock: Clock) =>
            new InvoiceIssues({ db, clock, ids: systemUuidV7(), sources, patients }),
        },
        {
          provide: INVOICE_READS,
          inject: [DATABASE],
          useFactory: (db: Database) => new InvoiceReads({ db, patients }),
        },
        {
          provide: FINANCE_SETTINGS,
          inject: [DATABASE, CLOCK],
          useFactory: (db: Database, clock: Clock) =>
            new ClinicFinanceSettings({
              db,
              clock,
              ids: systemUuidV7(),
              blobs: blobStore ?? blobStoreFromEnv(process.env),
            }),
        },
        {
          provide: INVOICE_CHANGES,
          inject: [DATABASE, CLOCK],
          useFactory: (db: Database, clock: Clock) =>
            new InvoiceChanges({ db, clock, ids: systemUuidV7(), patients }),
        },
      ],
    };
  }
}
