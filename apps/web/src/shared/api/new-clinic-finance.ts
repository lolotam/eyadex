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

/**
 * The tax rate's wrong-type message under both Zod majors (migration to Zod 4): Zod 3 reads
 * `invalid_type_error` and gives a missing value its default "Required"; Zod 4 ignores that key and
 * reads `error`, which returns the same two messages. Passed as a variable so each major's parameter
 * type accepts the other's key; no global error map.
 */
export const taxRateNumberParams = {
  invalid_type_error: "validation.number",
  error: (issue: { input?: unknown }) =>
    issue.input === undefined ? "Required" : "validation.number",
};

export const createClinicFormSchema = createClinicInputSchema.extend({
  currency: currencyCodeSchema,
  taxRateBp: z
    .number(taxRateNumberParams)
    .int("validation.number")
    .min(0, "validation.outOfRange")
    .max(10000, "validation.outOfRange"),
});
export type CreateClinicFormValues = z.infer<typeof createClinicFormSchema>;
