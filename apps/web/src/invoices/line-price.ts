import { useQuery } from "@tanstack/react-query";
import { formatMinor, parseMajorToMinor } from "@eyadex/contracts/money";
import type { Invoice, PriceList } from "@eyadex/contracts/finance";
import { ApiError } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { can } from "@/shared/permissions/can";
import { usePersona, useSession } from "@/shared/persona/persona-provider";
import { toDiscountInput, type LineValues } from "./invoice-form-draft";

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
 * The price a pick puts on the line: the doctor's price, else the base price, else 0.000 (the owner
 * decided on 2026-10-24 that a pick with no price resets the line). Null when no list may be read at
 * all — the line then keeps the price it had.
 */
export function pickedPriceMajor(
  list: PriceList | undefined,
  serviceId: string,
  providerId: string | null,
  exponent: number,
): string | null {
  if (!list) return null;
  return formatMinor(linePriceMinor(list, serviceId, providerId) ?? "0", exponent);
}

/** One discount as the API compares it: kind, amount (bp or minor) and reason. */
const discountKey = (d: Invoice["lines"][number]["discount"]) =>
  d === null ? null : [d.kind, d.kind === "pct" ? d.bp : d.minor, d.reason];

/**
 * True when the line is still a saved one, matched exactly as the API's `serviceKey` matches it
 * (service, doctor, quantity, unit price and discount): the API keeps such a line's price even when
 * the current price was removed (checkServiceLines), so the form must not call it unpriced. A change
 * to any of them makes it a new line, which needs a current price.
 */
function isSavedLine(
  line: LineValues,
  saved: readonly Invoice["lines"][number][],
  exponent: number,
): boolean {
  if (line.kind !== "service") return false;
  const minor = parseMajorToMinor(line.unitPrice, exponent);
  const discount = toDiscountInput(line.discount, exponent);
  if (minor === null || discount === "invalid") return false;
  const key = JSON.stringify(discountKey(discount));
  return saved.some(
    (s) =>
      s.kind === "service" &&
      s.serviceId === line.serviceId &&
      s.providerId === line.providerId &&
      s.quantity === line.quantity &&
      s.unitPriceMinor === minor &&
      JSON.stringify(discountKey(s.discount)) === key,
  );
}

/**
 * True when the line has no price in the list and the form must say so: a service with no price at
 * all (no doctor price and no base price). A saved line the user did not change is not one of them.
 */
export function isUnpricedLine(
  line: LineValues,
  list: PriceList | undefined,
  saved: readonly Invoice["lines"][number][],
  exponent: number,
): boolean {
  if (!list || line.kind !== "service" || line.serviceId === "") return false;
  if (linePriceMinor(list, line.serviceId, line.providerId) !== null) return false;
  return !isSavedLine(line, saved, exponent);
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
    !!session &&
    can(session.permissions, "view", "prices") &&
    // The finance module must be explicitly on, as `usePriceList` reads it; no flags count as off.
    session.features?.finance === true;
  const query = useQuery({
    queryKey: ["clinic", "prices", persona.clinicId, persona.memberId],
    queryFn: () => api.finance.prices(persona),
    enabled: ready && Boolean(persona.clinicId) && allowed,
    retry,
  });
  return {
    ...query,
    // A member without `view:prices` must not read the list, not even one the cache still holds.
    data: allowed ? query.data : undefined,
    /** The list is on its way and no price is known yet: a pick now would be lost, so the form waits. */
    loading: allowed && query.data === undefined && query.fetchStatus === "fetching",
    /** The request failed and no list arrived: the lines stay manual until a retry succeeds. */
    failed: allowed && query.isError && query.data === undefined,
  };
}
