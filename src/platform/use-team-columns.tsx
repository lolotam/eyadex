import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { CircleCheck, CircleSlash, Mail, Power, RotateCcw } from "lucide-react";
import type { PlatformAccount } from "@contracts/platform";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { RowActionsMenu } from "@/users/row-actions-menu";

const STATUS_ICON = { active: CircleCheck, invited: Mail, deactivated: CircleSlash } as const;

export function useTeamColumns(
  onStatus: (a: PlatformAccount) => void,
): ColumnDef<PlatformAccount, unknown>[] {
  const { t, formatDate } = useI18n();
  return useMemo(
    () => [
      {
        id: "name",
        header: t("team.columns.name"),
        cell: ({ row }) => <span className="font-medium">{row.original.fullName}</span>,
      },
      {
        id: "email",
        header: t("team.columns.email"),
        cell: ({ row }) => (
          <span dir="ltr" className="text-sm">
            {row.original.email}
          </span>
        ),
      },
      {
        id: "status",
        header: t("team.columns.status"),
        cell: ({ row }) => {
          const Icon = STATUS_ICON[row.original.status];
          return (
            <Badge
              variant={row.original.status === "active" ? "default" : "secondary"}
              className="gap-1.5 whitespace-nowrap"
            >
              <Icon className="size-3.5" />
              {t(`team.status.${row.original.status}`)}
            </Badge>
          );
        },
      },
      {
        id: "since",
        header: t("team.columns.since"),
        cell: ({ row }) => formatDate(row.original.createdAt),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">{t("common.actions")}</span>,
        cell: ({ row }) => {
          const off = row.original.status === "deactivated";
          return (
            <RowActionsMenu
              label={t("common.actions")}
              actions={[
                {
                  label: t(off ? "team.reactivate" : "team.deactivate"),
                  icon: off ? RotateCcw : Power,
                  onSelect: () => onStatus(row.original),
                },
              ]}
            />
          );
        },
      },
    ],
    [t, formatDate, onStatus],
  );
}
