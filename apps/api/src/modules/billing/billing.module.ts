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
import { PgInvoiceNotifications } from "../notifications/index.ts";
import { PgBillingPatients } from "../patients/index.ts";
// The public link's guards need the area hosts and the rate limiter (the invitations pattern).
import {
  AuthModule,
  ClinicAreaGuard,
  PgBillingLineDoctors,
  PgProviderDirectory,
  PublicRateLimitGuard,
} from "../identity/index.ts";
import { CLOCK, PgFilingBranches, TenancyModule, type Clock } from "../tenancy/index.ts";
import { InvoicePdfController } from "./http/invoice-pdf.controller.ts";
import { FinanceReportsController } from "./http/finance-reports.controller.ts";
import type { BillingReportStaff } from "./ports/billing-report-staff.ts";
import { FinanceReports } from "./use-cases/reports/reports.ts";
import { InvoiceSendController } from "./http/invoice-send.controller.ts";
import { CashClosingsController } from "./http/cash-closings.controller.ts";
import { InvoicesController } from "./http/invoices.controller.ts";
import { PaymentsController } from "./http/payments.controller.ts";
import { PublicInvoiceController } from "./http/public-invoice.controller.ts";
import { PricesController } from "./http/prices.controller.ts";
import { RefundsController } from "./http/refunds.controller.ts";
import { SettingsController } from "./http/settings.controller.ts";
import type { BillingBranchReader } from "./ports/billing-branches.ts";
import type { BillingLineDoctorLocks } from "./ports/billing-members.ts";
import type { BillingInvoiceNotifier } from "./ports/billing-notifier.ts";
import type { BillingPatientReader } from "./ports/billing-patients.ts";
import type { InvoicePdfRenderer } from "./ports/invoice-pdf.ts";
import type { BillingAppointmentReader, BillingVisitReader } from "./ports/billing-sources.ts";
import {
  CASH_CLOSING_READS,
  CASH_CLOSINGS,
  CREDIT_APPLICATIONS,
  INVOICE_CHANGES,
  INVOICE_DRAFTS,
  INVOICE_ISSUES,
  INVOICE_PDFS,
  INVOICE_PAYMENTS,
  INVOICE_READS,
  INVOICE_REFUNDS,
  INVOICE_SENDS,
  FINANCE_SETTINGS,
  FINANCE_REPORTS,
  PAYMENT_READS,
  PRICE_CHANGES,
  PUBLIC_INVOICE_LINKS,
  REFUND_READS,
} from "./ports/tokens.ts";
import { CashClosingReads } from "./use-cases/cash-closings/cash-closing-reads.ts";
import { CashClosings } from "./use-cases/cash-closings/cash-closings.ts";
import { RefundReads } from "./use-cases/refunds/refund-reads.ts";
import { InvoiceRefunds } from "./use-cases/refunds/refunds.ts";
import { ClinicFinanceSettings } from "./use-cases/settings/settings.ts";
import { InvoiceChanges } from "./use-cases/changes/changes.ts";
import { InvoiceDrafts } from "./use-cases/draft/draft.ts";
import { InvoiceIssues } from "./use-cases/issue/issue.ts";
import { InvoicePdfs } from "./use-cases/invoice-pdf/invoice-pdf.ts";
import { InvoiceSends } from "./use-cases/invoice-send/invoice-send.ts";
import { InvoiceReads } from "./use-cases/reads/reads.ts";
import { PriceChanges } from "./use-cases/prices/prices.ts";
import { PublicInvoiceLinks } from "./use-cases/public-link/public-link.ts";
import { InvoicePayments } from "./use-cases/payments/payments.ts";
import { CreditApplications } from "./use-cases/payments/credit-applications.ts";
import { PaymentReads } from "./use-cases/payment-reads/payment-reads.ts";
import { UnavailableInvoicePdf } from "./rendering/unavailable-invoice-pdf.ts";

// Typed against the module's own ports, so no adapter can drift from what the module needs.
const sources = {
  appointments: new PgBillingAppointments() satisfies BillingAppointmentReader,
  visits: new PgBillingVisits() satisfies BillingVisitReader,
};
const patients: BillingPatientReader = new PgBillingPatients();
const branches: BillingBranchReader = new PgFilingBranches();
const members: BillingLineDoctorLocks = new PgBillingLineDoctors();
const reportStaff: BillingReportStaff = new PgProviderDirectory();

/**
 * موديول المالية (finance F1 و F2): أسعار الخدمات، والفواتير، ومدفوعاتها ورصيد المراجع. كل الشغل على
 * pool الـ `eyadex_app` جوه `withTenant`، وكل مسار وراه `@RequiresFeature("finance")`؛ المنصة مالهاش أي
 * مسار هنا.
 */
@Module({})
export class BillingModule {
  /**
   * الموديول بمخزن اللوجو: اللي الاختبار بيديه، وإلا الـ bucket الخاص من البيئة (`MEDICAL_BLOB_S3_*`)، وإلا
   * مخزن مش متظبّط بيرد 503 على رفع اللوجو وقرايته بس.
   *
   * @param blobStore مخزن بديل (الاختبارات بس)
   * @param invoicePdf راسم بديل (الاختبارات بس)؛ غير كده `UnavailableInvoicePdf` لحد plan Task 8g
   * @returns الموديول
   */
  static forRoot(blobStore?: BlobStore, invoicePdf?: InvoicePdfRenderer): DynamicModule {
    // One renderer for the invoice page and the patient's link (spec §3.3, §8 rule 16).
    const pdf = invoicePdf ?? new UnavailableInvoicePdf();
    return {
      module: BillingModule,
      imports: [DatabaseModule, TenancyModule, AuthModule],
      controllers: [
        PricesController,
        InvoicesController,
        InvoiceSendController,
        InvoicePdfController,
        PublicInvoiceController,
        SettingsController,
        PaymentsController,
        RefundsController,
        CashClosingsController,
        FinanceReportsController,
      ],
      providers: [
        {
          provide: FINANCE_REPORTS,
          inject: [DATABASE, CLOCK],
          useFactory: (db: Database, clock: Clock) =>
            new FinanceReports({ db, clock, patients, staff: reportStaff }),
        },
        ClinicAreaGuard,
        PublicRateLimitGuard,
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
            new InvoiceIssues({ db, clock, ids: systemUuidV7(), sources, patients, members }),
        },
        {
          provide: INVOICE_READS,
          inject: [DATABASE],
          useFactory: (db: Database) => new InvoiceReads({ db, patients, visits: sources.visits }),
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
          provide: INVOICE_SENDS,
          inject: [DATABASE, CLOCK],
          useFactory: (db: Database, clock: Clock) => {
            const notifier: BillingInvoiceNotifier = new PgInvoiceNotifications({
              ids: systemUuidV7(),
              clock,
            });
            return new InvoiceSends({ db, patients, notifier });
          },
        },
        {
          provide: INVOICE_PDFS,
          inject: [DATABASE, CLOCK],
          useFactory: (db: Database, clock: Clock) =>
            new InvoicePdfs({ db, clock, ids: systemUuidV7(), patients, pdf }),
        },
        {
          provide: PUBLIC_INVOICE_LINKS,
          inject: [DATABASE, CLOCK],
          useFactory: (db: Database, clock: Clock) =>
            new PublicInvoiceLinks({
              db,
              clock,
              ids: systemUuidV7(),
              pdf,
            }),
        },
        {
          provide: INVOICE_CHANGES,
          inject: [DATABASE, CLOCK],
          useFactory: (db: Database, clock: Clock) =>
            new InvoiceChanges({ db, clock, ids: systemUuidV7(), patients, members }),
        },
        {
          provide: INVOICE_PAYMENTS,
          inject: [DATABASE, CLOCK],
          useFactory: (db: Database, clock: Clock) =>
            new InvoicePayments({ db, clock, ids: systemUuidV7(), patients }),
        },
        {
          provide: CREDIT_APPLICATIONS,
          inject: [DATABASE, CLOCK],
          useFactory: (db: Database, clock: Clock) =>
            new CreditApplications({ db, clock, ids: systemUuidV7(), patients }),
        },
        {
          provide: PAYMENT_READS,
          inject: [DATABASE],
          useFactory: (db: Database) => new PaymentReads({ db, patients, branches }),
        },
        {
          provide: INVOICE_REFUNDS,
          inject: [DATABASE, CLOCK],
          useFactory: (db: Database, clock: Clock) =>
            new InvoiceRefunds({ db, clock, ids: systemUuidV7(), patients }),
        },
        {
          provide: REFUND_READS,
          inject: [DATABASE],
          useFactory: (db: Database) => new RefundReads({ db, patients }),
        },
        {
          provide: CASH_CLOSINGS,
          inject: [DATABASE, CLOCK],
          useFactory: (db: Database, clock: Clock) =>
            new CashClosings({ db, clock, ids: systemUuidV7() }),
        },
        {
          provide: CASH_CLOSING_READS,
          inject: [DATABASE],
          useFactory: (db: Database) => new CashClosingReads({ db }),
        },
      ],
    };
  }
}
