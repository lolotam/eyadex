import { z } from "zod";
import { idSchema } from "./common.ts";
import {
  invoiceListItemSchema,
  invoiceSourceSchema,
  invoiceStatusSchema,
  settlementStateSchema,
} from "./finance-invoice.ts";

/** A real calendar day: impossible dates must not reach PostgreSQL's ::date and fail there. */
export const dateSchema = z
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
    // The list filter of spec §4.6: the settlement state (unpaid / partly_paid / paid).
    settlement: settlementStateSchema.optional(),
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    number: z.string().trim().min(1).max(40).optional(),
    // The «فاتورة» button looks up the live invoice of its appointment or visit (one at most, §3.2).
    source: invoiceSourceSchema.optional(),
    sourceId: idSchema.optional(),
    encounter: z
      .union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")])
      .optional(),
  })
  .strict()
  .refine((q) => q.sourceId === undefined || q.source !== undefined, {
    path: ["source"],
    message: "validation.required",
  })
  .refine(
    (q) =>
      q.encounter !== true ||
      ((q.source === "appointment" || q.source === "visit") && q.sourceId !== undefined),
    {
      path: ["encounter"],
      message: "validation.invoiceSource",
    },
  )
  .transform((q) => ({ ...q, encounter: q.encounter ?? false }));
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;

export const invoiceListResponseSchema = z
  .object({
    items: z.array(invoiceListItemSchema),
    nextCursor: z.string().nullable(),
    total: z.number().int().nonnegative(),
  })
  .strict();
