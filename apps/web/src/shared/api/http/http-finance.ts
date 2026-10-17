import {
  financeSettingsSchema,
  invoicePrefixItemSchema,
  invoicePrefixListSchema,
  platformClinicFinanceSchema,
  platformFinanceTotalsSchema,
  priceListResponseSchema,
  servicePriceResponseSchema,
} from "@eyadex/contracts/finance";
import { ApiError } from "../api-error";
import type { FinanceApi } from "../finance-client";
import type { HttpContext } from "./http-context";
import { createHttpInvoices } from "./http-invoices";

type SettingsPart = Pick<
  FinanceApi,
  | "prices"
  | "setServicePrice"
  | "setProviderPrices"
  | "settings"
  | "updateSettings"
  | "logo"
  | "uploadLogo"
  | "prefixes"
  | "setPrefix"
  | "platformFinance"
  | "updatePlatformFinance"
  | "platformTotals"
>;

function createHttpFinanceSettings({ transport }: HttpContext): SettingsPart {
  const id = encodeURIComponent;
  return {
    prices: () => transport.send("GET", "/v1/prices", { schema: priceListResponseSchema }),
    async setServicePrice(_persona, serviceId, priceMinor) {
      const answer = await transport.send("PATCH", `/v1/services/${id(serviceId)}/price`, {
        schema: servicePriceResponseSchema,
        body: { priceMinor },
      });
      return answer.servicePrice;
    },
    async setProviderPrices(_persona, serviceId, items) {
      const answer = await transport.send("PUT", `/v1/services/${id(serviceId)}/provider-prices`, {
        schema: servicePriceResponseSchema,
        body: { items },
      });
      return answer.servicePrice;
    },
    settings: () =>
      transport.send("GET", "/v1/clinic/settings/finance", { schema: financeSettingsSchema }),
    updateSettings: (_persona, commercialRegNo) =>
      transport.send("PATCH", "/v1/clinic/settings/finance", {
        schema: financeSettingsSchema,
        body: { commercialRegNo },
      }),
    async logo() {
      try {
        return await transport.download("/v1/clinic/logo");
      } catch (error) {
        if (error instanceof ApiError && error.code === "not_found") return null;
        throw error;
      }
    },
    uploadLogo: (_persona, file) =>
      transport.send("PUT", "/v1/clinic/logo", { schema: financeSettingsSchema, blob: file }),
    async prefixes() {
      const answer = await transport.send("GET", "/v1/invoice-prefixes", {
        schema: invoicePrefixListSchema,
      });
      return answer.items;
    },
    setPrefix: (_persona, branchId, invoicePrefix) =>
      transport.send("PUT", `/v1/invoice-prefixes/${id(branchId)}`, {
        schema: invoicePrefixItemSchema,
        body: { invoicePrefix },
      }),
    platformFinance: (_persona, clinicId) =>
      transport.send("GET", `/v1/platform/clinics/${id(clinicId)}/finance`, {
        schema: platformClinicFinanceSchema,
      }),
    updatePlatformFinance: (_persona, clinicId, input) =>
      transport.send("PATCH", `/v1/platform/clinics/${id(clinicId)}/finance`, {
        schema: platformClinicFinanceSchema,
        body: input,
      }),
    platformTotals: (_persona, clinicId) =>
      transport.send("GET", `/v1/platform/clinics/${id(clinicId)}/finance-totals`, {
        schema: platformFinanceTotalsSchema,
      }),
  };
}

export function createHttpFinance(ctx: HttpContext): FinanceApi {
  return { ...createHttpFinanceSettings(ctx), ...createHttpInvoices(ctx) };
}
