import { createClinicInputSchema } from "@eyadex/contracts/clinics";
import { currencyCodeSchema, type CurrencyCode } from "@eyadex/contracts/money";
import { z } from "zod";

/**
 * Finance F1 (spec §8 rule 6): the create-clinic request takes an optional currency and tax rate
 * (`createClinicRequestSchema`), but the web form contract `CreateClinicInput` predates them. The web
 * adds the two fields here instead of editing the frozen contract.
 */
export type NewClinicFinance = { currency?: CurrencyCode; taxRateBp?: number };

/** The two optional fields on their own (the mock reads them off the create request). */
export const newClinicFinanceSchema = z.object({
  currency: currencyCodeSchema.optional(),
  taxRateBp: z.number().int().min(0).max(10000).optional(),
});

export const DEFAULT_NEW_CLINIC_FINANCE = { currency: "KWD", taxRateBp: 0 } as const;

export const createClinicFormSchema = createClinicInputSchema.extend({
  currency: currencyCodeSchema,
  taxRateBp: z
    .number({ invalid_type_error: "validation.number" })
    .int("validation.number")
    .min(0, "validation.outOfRange")
    .max(10000, "validation.outOfRange"),
});
export type CreateClinicFormValues = z.infer<typeof createClinicFormSchema>;
