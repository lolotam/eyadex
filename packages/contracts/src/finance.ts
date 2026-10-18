import { z } from "zod";
import { idSchema, stripInvisibleControls } from "./common.ts";
import { currencyCodeSchema, minorAmountSchema, minorLineAmountSchema } from "./money.ts";
import { notificationChannelSchema } from "./notifications.ts";
import {
  invoiceListItemSchema,
  invoiceSourceSchema,
  invoiceStatusSchema,
} from "./finance-invoice.ts";

export * from "./finance-invoice.ts";

// Finance F1 contracts (docs/specs/finance-design.md §3, R1, R2). Amounts travel as decimal integer
// strings of minor units: a line is capped at 10¹² (minorLineAmountSchema), an aggregate at the
// bigint ceiling (minorAmountSchema), the same split the totals function checks.

const text = (max: number) =>
  z
    .string()
    .transform(stripInvisibleControls)
    .pipe(z.string().trim().max(max, "validation.tooLong"));
const requiredText = (max: number) => text(max).pipe(z.string().min(1, "validation.required"));

/** Spec §3.2: 2–6 upper-case letters or digits, unique per clinic, locked after the first invoice. */
export const invoicePrefixSchema = z.string().regex(/^[A-Z0-9]{2,6}$/, "validation.invoicePrefix");

const basisPointsSchema = z
  .number({ invalid_type_error: "validation.number" })
  .int("validation.number")
  .min(0, "validation.outOfRange")
  .max(10000, "validation.outOfRange");

// FIN-A7: a percentage (basis points) or an amount, always with a written reason.
const discountInput = (amount: z.ZodType<string>) =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("pct"), bp: basisPointsSchema, reason: requiredText(300) }).strict(),
    z.object({ kind: z.literal("amount"), minor: amount, reason: requiredText(300) }).strict(),
  ]);
export const lineDiscountInputSchema = discountInput(minorLineAmountSchema);
export const invoiceDiscountInputSchema = discountInput(minorAmountSchema);
export type DiscountInput = z.infer<typeof invoiceDiscountInputSchema>;

const quantitySchema = z
  .number({ invalid_type_error: "validation.number" })
  .int("validation.number")
  .min(1, "validation.outOfRange")
  .max(999, "validation.outOfRange");

/** One line; its position is its index in the request array. */
export const invoiceLineInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("service"),
      serviceId: idSchema,
      providerId: idSchema.nullable(),
      quantity: quantitySchema,
      unitPriceMinor: minorLineAmountSchema,
      discount: lineDiscountInputSchema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("free"),
      descriptionAr: requiredText(200),
      descriptionEn: requiredText(200),
      quantity: quantitySchema,
      unitPriceMinor: minorLineAmountSchema,
      discount: lineDiscountInputSchema.nullable(),
    })
    .strict(),
]);
export type InvoiceLineInput = z.infer<typeof invoiceLineInputSchema>;

const linesSchema = z.array(invoiceLineInputSchema).min(1, "validation.required").max(50);

/**
 * `POST /v1/invoices` (`Idempotency-Key`). A manual invoice names its patient and branch; an
 * appointment or visit invoice names only its source, and the API derives both from it (R1-7).
 */
export const createInvoiceRequestSchema = z
  .object({
    source: invoiceSourceSchema,
    sourceId: idSchema.nullable(),
    patientId: idSchema.nullable(),
    branchId: idSchema.nullable(),
    lines: linesSchema,
    invoiceDiscount: invoiceDiscountInputSchema.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const manual = value.source === "manual";
    const misplaced = (path: string) =>
      ctx.addIssue({ code: "custom", path: [path], message: "validation.invoiceSource" });
    if (manual !== (value.sourceId === null)) misplaced("sourceId");
    if (manual !== (value.patientId !== null)) misplaced("patientId");
    if (manual !== (value.branchId !== null)) misplaced("branchId");
  });
export type CreateInvoiceRequest = z.infer<typeof createInvoiceRequestSchema>;

/** `PATCH /v1/invoices/:id` with `If-Match` (FIN-A5): number, branch, source and date never change. */
export const updateInvoiceRequestSchema = z
  .object({ lines: linesSchema, invoiceDiscount: invoiceDiscountInputSchema.nullable() })
  .strict();
export type UpdateInvoiceRequest = z.infer<typeof updateInvoiceRequestSchema>;

/** `POST /v1/invoices/:id/void` with `If-Match` (FIN-8). */
export const voidInvoiceRequestSchema = z.object({ reason: requiredText(300) }).strict();

// A real calendar day: "2026-02-31" has the shape but would reach PostgreSQL's ::date and fail there.
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date")
  .refine((v) => {
    const day = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(day.getTime()) && day.toISOString().startsWith(v);
  }, "validation.date");

/** `GET /v1/invoices`: newest first, opaque cursor; dates are clinic-timezone days of `issuedAt`. */
export const invoiceListQuerySchema = z
  .object({
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    branchId: idSchema.optional(),
    patientId: idSchema.optional(),
    status: invoiceStatusSchema.optional(),
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    number: z.string().trim().min(1).max(40).optional(),
    // The «فاتورة» button looks up the live invoice of its appointment or visit (one at most, §3.2).
    source: invoiceSourceSchema.optional(),
    sourceId: idSchema.optional(),
  })
  .strict()
  .refine((q) => q.sourceId === undefined || q.source !== undefined, {
    path: ["source"],
    message: "validation.required",
  });
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;

export const invoiceListResponseSchema = z
  .object({
    items: z.array(invoiceListItemSchema),
    nextCursor: z.string().nullable(),
    total: z.number().int().nonnegative(),
  })
  .strict();

/** `GET /v1/invoices/draft`: pre-filled lines for the «فاتورة» button; nothing is stored. */
export const invoiceDraftQuerySchema = z
  .object({ source: z.enum(["appointment", "visit"]), id: idSchema })
  .strict();
/**
 * `GET /v1/invoices/draft` (R1-7): at most one service line; none for a walk-in visit. `priceMissing`
 * means the service has no doctor or base price yet: its line carries "0" and the issue refuses it
 * with `price_missing` until a price is set.
 */
export const invoiceDraftSchema = z
  .object({
    source: z.enum(["appointment", "visit"]),
    sourceId: idSchema,
    patientId: idSchema,
    branchId: idSchema,
    priceMissing: z.boolean(),
    lines: z.array(invoiceLineInputSchema),
  })
  .strict();
export type InvoiceDraft = z.infer<typeof invoiceDraftSchema>;

/** `PATCH /v1/services/:id/price`: the base price, or null for "no price yet". */
export const servicePriceRequestSchema = z
  .object({ priceMinor: minorLineAmountSchema.nullable() })
  .strict();

/** `PUT /v1/services/:id/provider-prices`: the whole per-doctor list for one service. */
export const providerPricesRequestSchema = z
  .object({
    items: z
      .array(z.object({ memberId: idSchema, priceMinor: minorLineAmountSchema }).strict())
      .max(200)
      .refine(
        (items) => new Set(items.map((i) => i.memberId)).size === items.length,
        "validation.duplicate",
      ),
  })
  .strict();

/** One service's base price and its per-doctor prices. */
export const servicePriceSchema = z
  .object({
    serviceId: idSchema,
    priceMinor: minorAmountSchema.nullable(),
    providerPrices: z.array(
      z.object({ memberId: idSchema, priceMinor: minorAmountSchema }).strict(),
    ),
  })
  .strict();
export type ServicePrice = z.infer<typeof servicePriceSchema>;

/** Both price writes answer the service's prices as saved. */
export const servicePriceResponseSchema = z.object({ servicePrice: servicePriceSchema }).strict();

/** `GET /v1/prices` (R1-13): `GET /services` never carries a price. */
export const priceListResponseSchema = z
  .object({
    currency: currencyCodeSchema,
    currencyExponent: z.number().int(),
    items: z.array(servicePriceSchema),
  })
  .strict();
export type PriceList = z.infer<typeof priceListResponseSchema>;

/**
 * `POST /v1/invoices/:id/send` (R2-5): the client makes `sendRequestId` once per press of «إرسال»;
 * a retry repeats it, a new press makes a new one. The message carries a private link to the invoice
 * (spec §8 rule 16, §8c.1 C1).
 */
export const sendInvoiceRequestSchema = z
  .object({ channel: notificationChannelSchema, sendRequestId: idSchema })
  .strict();
export type SendInvoiceRequest = z.infer<typeof sendInvoiceRequestSchema>;

/** The queued message: a repeated `sendRequestId` answers with the row it queued the first time. */
export const sendInvoiceResponseSchema = z.object({ notificationId: idSchema }).strict();
export type SendInvoiceResponse = z.infer<typeof sendInvoiceResponseSchema>;

/**
 * `GET /v1/clinic/settings/finance` (finance on, any member): what the web needs to show and compute
 * amounts — `formatMinor` takes the exponent, the invoice form takes the tax rate.
 */
export const financeSettingsSchema = z
  .object({
    currency: currencyCodeSchema,
    currencyExponent: z.number().int(),
    taxRateBp: z.number().int(),
    commercialRegNo: z.string().nullable(),
    hasLogo: z.boolean(),
  })
  .strict();
export type FinanceSettings = z.infer<typeof financeSettingsSchema>;

/**
 * A branch's invoice prefix (spec §8 rule 9): null until set; `locked` once the branch has issued an
 * invoice, after which it never changes.
 */
export const invoicePrefixItemSchema = z
  .object({
    branchId: idSchema,
    invoicePrefix: invoicePrefixSchema.nullable(),
    locked: z.boolean(),
  })
  .strict();
export type InvoicePrefixItem = z.infer<typeof invoicePrefixItemSchema>;

/** `GET /v1/invoice-prefixes`: every branch of the clinic, active or not. */
export const invoicePrefixListSchema = z
  .object({ items: z.array(invoicePrefixItemSchema) })
  .strict();

/** `PUT /v1/invoice-prefixes/:branchId` (`update:branches:clinic`); answers the branch's item. */
export const invoicePrefixRequestSchema = z.object({ invoicePrefix: invoicePrefixSchema }).strict();

/** `PATCH /v1/clinic/settings/finance`; the logo is its own upload. */
export const financeSettingsRequestSchema = z
  .object({ commercialRegNo: text(40).nullable() })
  .strict();

/** `PATCH /v1/platform/clinics/:id/finance`: currency only while the clinic has no price or invoice. */
export const platformClinicFinanceRequestSchema = z
  .object({ currency: currencyCodeSchema.optional(), taxRateBp: basisPointsSchema.optional() })
  .strict()
  .refine((v) => v.currency !== undefined || v.taxRateBp !== undefined, "validation.required");
export type PlatformClinicFinanceRequest = z.infer<typeof platformClinicFinanceRequestSchema>;

/** `GET`/`PATCH /v1/platform/clinics/:id/finance`: the clinic's currency, its exponent and tax rate. */
export const platformClinicFinanceSchema = z
  .object({
    currency: currencyCodeSchema,
    currencyExponent: z.number().int(),
    taxRateBp: z.number().int(),
  })
  .strict();
export type PlatformClinicFinance = z.infer<typeof platformClinicFinanceSchema>;

/** `GET /v1/platform/clinics/:id/finance-totals` (FIN-3): totals only, never an invoice row. */
export const platformFinanceTotalsSchema = z
  .object({
    months: z.array(
      z
        .object({
          month: z.string().regex(/^\d{4}-\d{2}$/),
          currency: currencyCodeSchema,
          invoicedMinor: minorAmountSchema,
        })
        .strict(),
    ),
  })
  .strict();
