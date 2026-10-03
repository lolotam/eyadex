import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Edit3, Eye, MoreHorizontal, Power, RotateCcw } from "lucide-react";
import type { RoleListItem } from "@eyadex/contracts/roles";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { RoleStatusBadge } from "./role-status-badge";

type Options = {
  mayUpdate: boolean;
  mayDeactivate: boolean;
  onOpen: (role: RoleListItem) => void;
  onToggle: (role: RoleListItem) => void;
};

export function useRoleColumns({ mayUpdate, mayDeactivate, onOpen, onToggle }: Options) {
  const { t, pick } = useI18n();
  return useMemo<ColumnDef<RoleListItem, unknown>[]>(
    () => [
      {
        id: "name",
        header: t("roles.columns.name"),
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
        id: "members",
        header: t("roles.columns.members"),
        cell: ({ row }) => <span className="tabular-nums">{row.original.memberCount}</span>,
      },
      {
        id: "permissions",
        header: t("roles.columns.permissions"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {t("roles.permissionCount", { count: row.original.permissionKeys.length })}
          </span>
        ),
      },
      {
        id: "status",
        header: t("roles.columns.status"),
        cell: ({ row }) => (
          <RoleStatusBadge active={row.original.isActive} locked={row.original.isLocked} />
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">{t("roles.columns.actions")}</span>,
        cell: ({ row }) => {
          const role = row.original;
          const editable = mayUpdate && !role.isLocked;
          return (
            <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t("roles.columns.actions")}>
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onOpen(role)}>
                    {editable ? <Edit3 className="size-4" /> : <Eye className="size-4" />}
                    {t(editable ? "roles.edit" : "roles.view")}
                  </DropdownMenuItem>
                  {mayDeactivate && !role.isLocked && (
                    <DropdownMenuItem onClick={() => onToggle(role)}>
                      {role.isActive ? (
                        <Power className="size-4" />
                      ) : (
                        <RotateCcw className="size-4" />
                      )}
                      {t(role.isActive ? "roles.deactivate" : "roles.reactivate")}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ],
    [mayDeactivate, mayUpdate, onOpen, onToggle, pick, t],
  );
}
