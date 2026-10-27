import { z } from "zod";
import { legacyNumber } from "./number-compat.ts";
import { legacyInteger } from "./integer-compat.ts";
import { utcDatetime } from "./datetime-compat.ts";
import { idSchema } from "./common.ts";
import { currencyCodeSchema, minorAmountSchema, readMinor } from "./money.ts";

export const invoiceSourceSchema = z.enum(["appointment", "visit", "manual"]);
export type InvoiceSource = z.infer<typeof invoiceSourceSchema>;

const discountSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("pct"),
      bp: legacyNumber().check(legacyInteger()),
      reason: z.string(),
    })
    .strict(),
  z.object({ kind: z.literal("amount"), minor: minorAmountSchema, reason: z.string() }).strict(),
]);

export const invoiceLineSchema = z
  .object({
    position: legacyNumber().check(legacyInteger()).check(z.nonnegative()),
    kind: z.enum(["service", "free"]),
    serviceId: idSchema.nullable(),
    providerId: idSchema.nullable(),
    descriptionAr: z.string(),
    descriptionEn: z.string(),
    quantity: legacyNumber().check(legacyInteger()),
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

export const invoiceObjectSchema = z
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
    issuedAt: utcDatetime(),
    currency: currencyCodeSchema,
    currencyExponent: legacyNumber().check(legacyInteger()),
    subtotalMinor: minorAmountSchema,
    discountMinor: minorAmountSchema,
    taxRateBp: legacyNumber().check(legacyInteger()),
    taxMinor: minorAmountSchema,
    totalMinor: minorAmountSchema,
    // Optional so existing F1 API writes and mock responses remain valid until settlement ships.
    settlement: invoiceSettlementSchema.nullable().optional(),
    invoiceDiscount: discountSchema.nullable(),
    lines: z.array(invoiceLineSchema),
    voidReason: z.string().nullable(),
    voidedAt: utcDatetime().nullable(),
    version: legacyNumber().check(legacyInteger()).check(z.positive()),
  })
  .strict();

/** The fields the settlement rule reads, so one rule serves the invoice and its list item. */
type SettlementStatusShape = {
  status: z.infer<typeof invoiceStatusSchema>;
  totalMinor: string;
  settlement?: z.infer<typeof invoiceSettlementSchema> | null | undefined;
};

/** An issued invoice carries its settlement; a void invoice carries none. */
const statusAgreesWithSettlement = (invoice: SettlementStatusShape): boolean => {
  const issuedWithoutSettlement = invoice.status === "issued" && invoice.settlement === null;
  const voidWithSettlement = invoice.status === "void" && invoice.settlement !== null;
  return !issuedWithoutSettlement && !voidWithSettlement;
};

/**
 * On an issued invoice the paid plus the owed is the invoiced total (owed = total − paid), so a settlement
 * that does not add up is refused. The amounts are canonical decimal strings, so bigint keeps them exact.
 */
const settlementSumsToTotal = (invoice: SettlementStatusShape): boolean => {
  const settlement = invoice.settlement;
  if (invoice.status !== "issued" || settlement === null || settlement === undefined) return true;
  const paid = readMinor(settlement.paidMinor);
  const owed = readMinor(settlement.owedMinor);
  const total = readMinor(invoice.totalMinor);
  if (paid === null || owed === null || total === null) return true;
  return paid + owed === total;
};

/**
 * The settlement must agree with the status and add up to the total, so no reader sees a void invoice
 * carrying a balance or a balance that does not belong to the invoice.
 */
const settlementMatchesStatus = (invoice: SettlementStatusShape, ctx: z.RefinementCtx): void => {
  if (invoice.settlement === undefined) return;
  if (statusAgreesWithSettlement(invoice) && settlementSumsToTotal(invoice)) return;
  ctx.addIssue({ code: "custom", path: ["settlement"], message: "validation.invoiceSettlement" });
};

/**
 * The settlement must agree with the status and add up to the total, so no reader sees a balance that
 * does not belong to the invoice.
 */
export const invoiceSchema = invoiceObjectSchema.superRefine(settlementMatchesStatus);
export type Invoice = z.infer<typeof invoiceSchema>;

/** Every invoice write answers the invoice as saved; the version also travels as `ETag`. */
export const invoiceWriteResponseSchema = z.object({ invoice: invoiceSchema }).strict();

export const invoiceListItemSchema = invoiceObjectSchema
  .omit({ lines: true })
  .extend({ patientName: z.string() })
  .strict()
  .superRefine(settlementMatchesStatus);
