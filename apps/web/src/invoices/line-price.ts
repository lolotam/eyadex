import { useQuery } from "@tanstack/react-query";
import type { PriceList } from "@eyadex/contracts/finance";
import { ApiError } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { can } from "@/shared/permissions/can";
import { usePersona, useSession } from "@/shared/persona/persona-provider";

const retry = (count: number, error: unknown) => !(error instanceof ApiError) && count < 2;

/**
 * The line's price in minor units: the doctor's own price for the service first (the API looks up
 * `providerPrices` by the line's membership id the same way), else the base price; null when neither.
 */
export function linePriceMinor(
  list: PriceList | undefined,
  serviceId: string,
  providerId: string | null,
): string | null {
  const entry = list?.items.find((p) => p.serviceId === serviceId);
  if (!entry) return null;
  const own = providerId ? entry.providerPrices.find((d) => d.memberId === providerId) : undefined;
  return own?.priceMinor ?? entry.priceMinor;
}

/**
 * `GET /v1/prices` for filling invoice lines; asked only with `view:prices` and finance on, so a role
 * without the key never sends it and keeps typing prices by hand. Kept here: areas never import others.
 */
export function useLinePrices() {
  const api = useApi();
  const { persona, ready } = usePersona();
  const { session } = useSession();
  const allowed =
    !!session && can(session.permissions, "view", "prices") && session.features?.finance !== false;
  return useQuery({
    queryKey: ["clinic", "prices", persona.clinicId, persona.memberId],
    queryFn: () => api.finance.prices(persona),
    enabled: ready && Boolean(persona.clinicId) && allowed,
    retry,
  });
}
