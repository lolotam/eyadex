import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatMinor, parseMajorToMinor } from "@eyadex/contracts/money";
import { ApiError } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { usePersona, useSession } from "@/shared/persona/persona-provider";

export const financeSettingsKey = ["clinic", "finance", "settings"] as const;

/** The clinic's finance details (currency, exponent, tax). Disabled when the module is off. */
export function useFinanceSettings() {
  const api = useApi();
  const { persona, ready } = usePersona();
  const { session } = useSession();
  return useQuery({
    queryKey: [...financeSettingsKey, persona.clinicId, persona.memberId],
    queryFn: () => api.finance.settings(persona),
    enabled: ready && Boolean(persona.clinicId) && session?.features.finance === true,
    retry: (count, error) => !(error instanceof ApiError) && count < 2,
    staleTime: 60_000,
  });
}

/** A rate in basis points as a percent text (1500 → "15 %"). */
export const formatBp = (bp: number): string => `${(bp / 100).toLocaleString("en-US")} %`;

/**
 * Amounts in the clinic's own currency and exponent (never a hardcoded KWD or 3 decimals). Amounts
 * stay minor-unit strings; `parse` returns null for text that is not an amount in that exponent.
 */
export function useClinicMoney() {
  const settings = useFinanceSettings();
  const currency = settings.data?.currency ?? null;
  const exponent = settings.data?.currencyExponent ?? null;
  const format = useCallback(
    (minor: string) => (exponent === null ? "…" : `${formatMinor(minor, exponent)} ${currency}`),
    [currency, exponent],
  );
  const toMajor = useCallback(
    (minor: string) => (exponent === null ? "" : formatMinor(minor, exponent)),
    [exponent],
  );
  const parse = useCallback(
    (text: string) => (exponent === null ? null : parseMajorToMinor(text.trim(), exponent)),
    [exponent],
  );
  return useMemo(
    () => ({ settings, currency, exponent, taxRateBp: settings.data?.taxRateBp ?? 0, format, toMajor, parse }),
    [settings, currency, exponent, format, toMajor, parse],
  );
}
