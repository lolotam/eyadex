import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatMinor, parseMajorToMinor } from "@eyadex/contracts/money";
import type { PriceList, ServicePrice } from "@eyadex/contracts/finance";
import { ApiError } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { usePersona, useSession } from "@/shared/persona/persona-provider";

export const priceKeys = { all: ["clinic", "prices"] as const };

const retry = (count: number, error: unknown) => !(error instanceof ApiError) && count < 2;

/** `GET /v1/prices`, asked only with `view:prices:clinic` and the finance module on. */
export function usePriceList(allowed: boolean) {
  const api = useApi();
  const { persona, ready } = usePersona();
  const { session } = useSession();
  return useQuery({
    queryKey: [...priceKeys.all, persona.clinicId, persona.memberId],
    queryFn: () => api.finance.prices(persona),
    enabled: ready && Boolean(persona.clinicId) && allowed && session?.features.finance === true,
    retry,
  });
}

export function useRefreshPrices() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: priceKeys.all });
}

/** The service's prices from the list, or an empty entry (no base price, no doctor prices). */
export function priceOf(list: PriceList | undefined, serviceId: string): ServicePrice {
  return (
    list?.items.find((p) => p.serviceId === serviceId) ?? {
      serviceId,
      priceMinor: null,
      providerPrices: [],
    }
  );
}

/** A minor-unit amount as major-unit text with its currency, e.g. "12.500 KWD". */
export const priceText = (list: PriceList, minor: string) =>
  `${formatMinor(minor, list.currencyExponent)} ${list.currency}`;

/** Major-unit text → minor string, or null when the text is not an amount in the exponent. */
export function minorOfText(text: string, exponent: number): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  try {
    return parseMajorToMinor(trimmed, exponent);
  } catch {
    return null;
  }
}
