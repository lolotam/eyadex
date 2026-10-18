import type { PriceList } from "@eyadex/contracts/finance";
import type { ClinicService } from "@eyadex/contracts/services";

/**
 * Item 8 (owner decision b): a role with `view:prices` but no `view:services` reads the services from
 * `GET /v1/prices` only — name, status and price, no duration, no service writes.
 */
export function servicesOfPriceList(list: PriceList | undefined): ClinicService[] {
  return (list?.items ?? []).map((p) => ({
    id: p.serviceId,
    nameAr: p.nameAr ?? "",
    nameEn: p.nameEn ?? "",
    status: p.status ?? "active",
    // Not in the price list and never shown here (the duration column is off).
    durationMinutes: 0,
    createdAt: new Date(0).toISOString(),
  }));
}
