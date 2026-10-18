import { useMemo, useState } from "react";
import { AlertCircle, ListChecks } from "lucide-react";
import { serviceStatusSchema, type ClinicService } from "@eyadex/contracts/services";
import type { PriceList } from "@eyadex/contracts/finance";
import { Button } from "@/components/ui/button";
import { errorCodeOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { can } from "@/shared/permissions/can";
import { useSession } from "@/shared/persona/persona-provider";
import { SectionHeader } from "@/shared/shell/section-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { DataTable } from "@/shared/table/data-table";
import { FilterSelect } from "@/shared/table/filter-select";
import { usePriceList } from "./price-queries";
import { ProviderPricesDialog } from "./provider-prices-dialog";
import { ServicePriceDialog } from "./service-price-dialog";
import { useServiceColumns } from "./use-service-columns";

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

export function PricesOnlyServices() {
  const { t, tDynamic } = useI18n();
  const { session } = useSession();
  const permissions = session?.permissions ?? [];
  const prices = usePriceList(true);
  const [status, setStatus] = useState<string | null>("active");
  const [pricing, setPricing] = useState<ClinicService | null>(null);
  const [providerPricing, setProviderPricing] = useState<ClinicService | null>(null);
  const rows = useMemo(
    () => servicesOfPriceList(prices.data).filter((s) => !status || s.status === status),
    [prices.data, status],
  );
  const columns = useServiceColumns({
    mayUpdate: false,
    mayDeactivate: false,
    onEdit: () => undefined,
    onStatus: () => undefined,
    prices: prices.data,
    mayPrice: can(permissions, "update", "prices"),
    onPrice: setPricing,
    onProviderPrices: setProviderPricing,
    withDuration: false,
  });
  if (prices.isError) {
    return (
      <StatusPanel
        icon={AlertCircle}
        title={t("services.loadError")}
        body={tDynamic(`errors.${errorCodeOf(prices.error)}`)}
        action={<Button onClick={() => void prices.refetch()}>{t("common.tryAgain")}</Button>}
      />
    );
  }
  return (
    <div>
      <SectionHeader title={t("services.title")} subtitle={t("services.subtitle")} />
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
        <FilterSelect
          label={t("services.columns.status")}
          value={status}
          anyLabel={t("services.anyStatus")}
          options={serviceStatusSchema.options.map((s) => ({
            value: s,
            label: t(`services.status.${s}`),
          }))}
          onChange={setStatus}
        />
      </div>
      {!prices.isLoading && rows.length === 0 ? (
        <StatusPanel icon={ListChecks} title={t("services.empty")} body={t("services.emptyBody")} />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[480px]">
            <DataTable
              columns={columns}
              data={rows}
              isLoading={prices.isLoading}
              stickyEndColumnId="actions"
            />
          </div>
        </div>
      )}
      {prices.data && (
        <>
          <ServicePriceDialog
            service={pricing}
            list={prices.data}
            onClose={() => setPricing(null)}
          />
          <ProviderPricesDialog
            service={providerPricing}
            list={prices.data}
            onClose={() => setProviderPricing(null)}
          />
        </>
      )}
    </div>
  );
}
