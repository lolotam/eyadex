import type {
  CreateInvoiceRequest,
  FinanceSettings,
  Invoice,
  InvoiceDraft,
  InvoiceListQuery,
  InvoicePrefixItem,
  PlatformClinicFinance,
  PaymentMethodsRequest,
  PlatformClinicFinanceRequest,
  PriceList,
  SendInvoiceRequest,
  SendInvoiceResponse,
  ServicePrice,
  UpdateInvoiceRequest,
  invoiceListItemSchema,
  platformFinanceTotalsSchema,
} from "@eyadex/contracts/finance";
import type { Persona } from "@eyadex/contracts/session";
import type { z } from "zod";

export type InvoiceListItem = z.infer<typeof invoiceListItemSchema>;
export type InvoiceList = { items: InvoiceListItem[]; nextCursor: string | null; total: number };
export type PlatformFinanceTotals = z.infer<typeof platformFinanceTotalsSchema>;
export type ProviderPriceItem = { memberId: string; priceMinor: string };

/**
 * Finance F1 (docs/specs/finance-design.md §3): prices, the clinic's finance details, invoice
 * prefixes and invoices. Every clinic call is refused with module_disabled while finance is off.
 * Amounts are minor-unit strings, never numbers.
 */
export interface FinanceApi {
  prices(persona: Persona): Promise<PriceList>;
  setServicePrice(
    persona: Persona,
    serviceId: string,
    priceMinor: string | null,
  ): Promise<ServicePrice>;
  setProviderPrices(
    persona: Persona,
    serviceId: string,
    items: ProviderPriceItem[],
  ): Promise<ServicePrice>;
  settings(persona: Persona): Promise<FinanceSettings>;
  updateSettings(persona: Persona, commercialRegNo: string | null): Promise<FinanceSettings>;
  /** Null when the clinic has no logo yet. */
  logo(persona: Persona): Promise<Blob | null>;
  /** PNG or JPEG of at most 1 MB, sent as the raw body; anything else is `validation`. */
  uploadLogo(persona: Persona, file: Blob): Promise<FinanceSettings>;
  /** F2: replaces all four method switches; needs `update:clinic_settings:clinic`. */
  setPaymentMethods(
    persona: Persona,
    paymentMethods: PaymentMethodsRequest["paymentMethods"],
  ): Promise<PaymentMethodsRequest>;
  prefixes(persona: Persona): Promise<InvoicePrefixItem[]>;
  setPrefix(persona: Persona, branchId: string, invoicePrefix: string): Promise<InvoicePrefixItem>;
  listInvoices(persona: Persona, query: Partial<InvoiceListQuery>): Promise<InvoiceList>;
  getInvoice(persona: Persona, invoiceId: string): Promise<Invoice>;
  draft(persona: Persona, source: "appointment" | "visit", id: string): Promise<InvoiceDraft>;
  /** A retry with the same key replays the first invoice; a changed request is a conflict. */
  issue(persona: Persona, input: CreateInvoiceRequest, idempotencyKey: string): Promise<Invoice>;
  /** `If-Match: version`; a stale version is `version_conflict`. */
  edit(
    persona: Persona,
    invoiceId: string,
    version: number,
    input: UpdateInvoiceRequest,
  ): Promise<Invoice>;
  voidInvoice(
    persona: Persona,
    invoiceId: string,
    version: number,
    reason: string,
  ): Promise<Invoice>;
  /** The invoice PDF (`application/pdf`); the browser prints it. */
  pdf(persona: Persona, invoiceId: string): Promise<Blob>;
  send(
    persona: Persona,
    invoiceId: string,
    input: SendInvoiceRequest,
  ): Promise<SendInvoiceResponse>;
  /** Platform only: a clinic's currency and tax rate, and its monthly totals (never an invoice row). */
  platformFinance(persona: Persona, clinicId: string): Promise<PlatformClinicFinance>;
  updatePlatformFinance(
    persona: Persona,
    clinicId: string,
    input: PlatformClinicFinanceRequest,
  ): Promise<PlatformClinicFinance>;
  platformTotals(persona: Persona, clinicId: string): Promise<PlatformFinanceTotals>;
}
