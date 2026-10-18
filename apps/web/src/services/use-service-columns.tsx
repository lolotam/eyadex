import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Edit3, Power, RotateCcw, Tag, Users } from "lucide-react";
import type { PriceList } from "@eyadex/contracts/finance";
import type { ClinicService } from "@eyadex/contracts/services";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { RowActionsMenu, type RowAction } from "@/shared/table/row-actions-menu";
import { priceOf, priceText } from "./price-queries";
import { ServiceStatusBadge } from "./service-status-badge";

type Handlers = {
  mayUpdate: boolean;
  mayDeactivate: boolean;
  onEdit: (service: ClinicService) => void;
  onStatus: (service: ClinicService) => void;
  /** Finance F1 §1: present only with view:prices:clinic and the module on. */
  prices?: PriceList | undefined;
  mayPrice?: boolean;
  onPrice?: (service: ClinicService) => void;
  onProviderPrices?: (service: ClinicService) => void;
  /** False for a prices-only role: `GET /v1/prices` carries no duration. */
  withDuration?: boolean;
};

export function useServiceColumns(h: Handlers): ColumnDef<ClinicService, unknown>[] {
  const { t, pick } = useI18n();
  const { mayUpdate, mayDeactivate, onEdit, onStatus, prices, onPrice, onProviderPrices } = h;
  const mayPrice = Boolean(h.mayPrice && prices);
  return useMemo(() => {
    const cols: ColumnDef<ClinicService, unknown>[] = [
      {
        id: "name",
        header: t("services.columns.name"),
        cell: ({ row }) => (
          <div className="min-w-36">
            <div className="font-medium">{pick(row.original.nameAr, row.original.nameEn)}</div>
            <div className="text-xs text-muted-foreground">
              {pick(row.original.nameEn, row.original.nameAr)}
            </div>
          </div>
        ),
      },
      ...(h.withDuration === false
        ? []
        : [
      {
        id: "duration",
        header: t("services.columns.duration"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {t("services.minutes", { count: row.original.durationMinutes })}
          </span>
        ),
      },
          ] satisfies ColumnDef<ClinicService, unknown>[]),
      ...(prices
        ? [
            {
              id: "price",
              header: t("finance.prices.column"),
              cell: ({ row }) => {
                const minor = priceOf(prices, row.original.id).priceMinor;
                return (
                  <span className="whitespace-nowrap tabular-nums">
                    {minor === null ? t("finance.noPrice") : priceText(prices, minor)}
                  </span>
                );
              },
            } satisfies ColumnDef<ClinicService, unknown>,
          ]
        : []),
      {
        id: "status",
        header: t("services.columns.status"),
        cell: ({ row }) => <ServiceStatusBadge status={row.original.status} />,
      },
    ];
    if (mayUpdate || mayDeactivate || mayPrice) {
      cols.push({
        id: "actions",
        header: () => <span className="sr-only">{t("services.columns.actions")}</span>,
        cell: ({ row }) => {
          const service = row.original;
          const actions: RowAction[] = [];
          if (mayUpdate)
            actions.push({ label: t("common.edit"), icon: Edit3, onSelect: () => onEdit(service) });
          if (mayPrice) {
            actions.push({
              label: t("finance.prices.edit"),
              icon: Tag,
              onSelect: () => onPrice?.(service),
            });
            actions.push({
              label: t("finance.prices.providers"),
              icon: Users,
              onSelect: () => onProviderPrices?.(service),
            });
          }
          if (mayDeactivate) {
            const active = service.status === "active";
            actions.push({
              label: t(active ? "services.deactivate" : "services.reactivate"),
              icon: active ? Power : RotateCcw,
              onSelect: () => onStatus(service),
            });
          }
          return <RowActionsMenu label={t("services.columns.actions")} actions={actions} />;
        },
      });
    }
    return cols;
  }, [
    t,
    pick,
    mayUpdate,
    mayDeactivate,
    onEdit,
    onStatus,
    prices,
    mayPrice,
    onPrice,
    onProviderPrices,
    h.withDuration,
  ]);
}
