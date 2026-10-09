import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Edit3, Power, RotateCcw } from "lucide-react";
import type { ClinicService } from "@eyadex/contracts/services";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { RowActionsMenu, type RowAction } from "@/shared/table/row-actions-menu";
import { ServiceStatusBadge } from "./service-status-badge";

type Handlers = {
  mayUpdate: boolean;
  mayDeactivate: boolean;
  onEdit: (service: ClinicService) => void;
  onStatus: (service: ClinicService) => void;
};

export function useServiceColumns(h: Handlers): ColumnDef<ClinicService, unknown>[] {
  const { t, pick } = useI18n();
  const { mayUpdate, mayDeactivate, onEdit, onStatus } = h;
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
      {
        id: "duration",
        header: t("services.columns.duration"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {t("services.minutes", { count: row.original.durationMinutes })}
          </span>
        ),
      },
      {
        id: "status",
        header: t("services.columns.status"),
        cell: ({ row }) => <ServiceStatusBadge status={row.original.status} />,
      },
    ];
    if (mayUpdate || mayDeactivate) {
      cols.push({
        id: "actions",
        header: () => <span className="sr-only">{t("services.columns.actions")}</span>,
        cell: ({ row }) => {
          const service = row.original;
          const actions: RowAction[] = [];
          if (mayUpdate)
            actions.push({ label: t("common.edit"), icon: Edit3, onSelect: () => onEdit(service) });
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
  }, [t, pick, mayUpdate, mayDeactivate, onEdit, onStatus]);
}
