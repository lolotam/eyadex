import { createClinicInputSchema } from "@eyadex/contracts/clinics";
import { legacyInteger } from "@eyadex/contracts/integer-compat";
import { currencyCodeSchema, type CurrencyCode } from "@eyadex/contracts/money";
import { legacyNumber } from "@eyadex/contracts/number-compat";
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
  taxRateBp: legacyNumber()
    .check(legacyInteger())
    .check(z.gte(0))
    .check(z.lte(10000))
    .optional(),
});

export const DEFAULT_NEW_CLINIC_FINANCE = { currency: "KWD", taxRateBp: 0 } as const;

/**
 * The tax rate's wrong-type message: a missing value keeps Zod 3's "Required", any other wrong type
 * reads `validation.number`. `legacyNumber` reads `error`; `invalid_type_error` stays for any Zod 3
 * reader of this exported object. No global error map.
 */
export const taxRateNumberParams = {
  invalid_type_error: "validation.number",
  error: (issue: { input?: unknown }) =>
    issue.input === undefined ? "Required" : "validation.number",
};

// legacyNumber/legacyInteger keep Zod 3's order: integer and range issues both report, and ±Infinity
// reaches the bounds instead of stopping at the number type.
export const createClinicFormSchema = createClinicInputSchema.extend({
  currency: currencyCodeSchema,
  taxRateBp: legacyNumber(taxRateNumberParams.error)
    .check(legacyInteger("validation.number"))
    .check(z.gte(0, "validation.outOfRange"))
    .check(z.lte(10000, "validation.outOfRange")),
});
export type CreateClinicFormValues = z.infer<typeof createClinicFormSchema>;
