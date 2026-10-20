import { z } from "zod";
import { idSchema } from "./common.ts";
import { currencyCodeSchema, minorAmountSchema } from "./money.ts";

export const invoiceSourceSchema = z.enum(["appointment", "visit", "manual"]);
export type InvoiceSource = z.infer<typeof invoiceSourceSchema>;

const discountSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pct"), bp: z.number().int(), reason: z.string() }).strict(),
  z.object({ kind: z.literal("amount"), minor: minorAmountSchema, reason: z.string() }).strict(),
]);

export const invoiceLineSchema = z
  .object({
    position: z.number().int().nonnegative(),
    kind: z.enum(["service", "free"]),
    serviceId: idSchema.nullable(),
    providerId: idSchema.nullable(),
    descriptionAr: z.string(),
    descriptionEn: z.string(),
    quantity: z.number().int(),
    unitPriceMinor: minorAmountSchema,
    discount: discountSchema.nullable(),
    lineTotalMinor: minorAmountSchema,
  })
  .strict();

export const invoiceStatusSchema = z.enum(["issued", "void"]);

/** Derived only for issued invoices; void invoices have no settlement state. */
export const settlementStateSchema = z.enum(["unpaid", "partly_paid", "paid"]);

/** Keeps the derived state consistent with its amounts, including a paid zero-total invoice. */
export const invoiceSettlementSchema = z
  .object({
    state: settlementStateSchema,
    paidMinor: minorAmountSchema,
    owedMinor: minorAmountSchema,
  })
  .strict()
  .refine(
    (v) =>
      v.state === "paid"
        ? v.owedMinor === "0"
        : v.owedMinor !== "0" && (v.state === "unpaid" ? v.paidMinor === "0" : v.paidMinor !== "0"),
    "validation.amount",
  );
export type InvoiceSettlement = z.infer<typeof invoiceSettlementSchema>;

export const invoiceSchema = z
  .object({
    id: idSchema,
    number: z.string(),
    status: invoiceStatusSchema,
    source: invoiceSourceSchema,
    sourceId: idSchema.nullable(),
    branchId: idSchema,
    // Read with the invoice, never stored on it: a doctor's own invoices cross branches the doctor's
    // own branch list does not name (PR #78 review).
    branchNameAr: z.string(),
    branchNameEn: z.string(),
    patientId: idSchema,
    // Optional on detail so existing invoice writes and stored clients remain compatible.
    patientName: z.string().optional(),
    issuedAt: z.string().datetime(),
    currency: currencyCodeSchema,
    currencyExponent: z.number().int(),
    subtotalMinor: minorAmountSchema,
    discountMinor: minorAmountSchema,
    taxRateBp: z.number().int(),
    taxMinor: minorAmountSchema,
    totalMinor: minorAmountSchema,
    // Optional so existing F1 API writes and mock responses remain valid until settlement ships.
    settlement: invoiceSettlementSchema.nullable().optional(),
    invoiceDiscount: discountSchema.nullable(),
    lines: z.array(invoiceLineSchema),
    voidReason: z.string().nullable(),
    voidedAt: z.string().datetime().nullable(),
    version: z.number().int().positive(),
  })
  .strict();
export type Invoice = z.infer<typeof invoiceSchema>;

/** Every invoice write answers the invoice as saved; the version also travels as `ETag`. */
export const invoiceWriteResponseSchema = z.object({ invoice: invoiceSchema }).strict();

export const invoiceListItemSchema = invoiceSchema
  .omit({ lines: true })
  .extend({ patientName: z.string() })
  .strict();
