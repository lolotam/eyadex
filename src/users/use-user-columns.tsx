import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { GitBranch, Power, RotateCcw, ShieldCheck } from "lucide-react";
import type { BranchOption, MembershipUserView } from "@contracts/users";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { BranchChips } from "./branch-chips";
import { RowActionsMenu, type RowAction } from "./row-actions-menu";
import { UserStatusBadge } from "./user-status-badge";

type Handlers = {
  mayUpdate: boolean;
  mayDeactivate: boolean;
  branches: BranchOption[];
  onRole: (u: MembershipUserView) => void;
  onBranches: (u: MembershipUserView) => void;
  onStatus: (u: MembershipUserView) => void;
};

export function useUserColumns(h: Handlers): ColumnDef<MembershipUserView, unknown>[] {
  const { t, pick, formatDate } = useI18n();
  const { mayUpdate, mayDeactivate, branches, onRole, onBranches, onStatus } = h;
  return useMemo(() => {
    const cols: ColumnDef<MembershipUserView, unknown>[] = [
      {
        id: "name",
        header: t("users.columns.name"),
        cell: ({ row }) => <span className="font-medium">{row.original.fullName}</span>,
      },
      {
        id: "email",
        header: t("users.columns.email"),
        cell: ({ row }) => (
          <span dir="ltr" className="text-sm">
            {row.original.email}
          </span>
        ),
      },
      {
        id: "role",
        header: t("users.columns.role"),
        cell: ({ row }) => pick(row.original.roleNameAr, row.original.roleNameEn),
      },
      {
        id: "branches",
        header: t("users.columns.branches"),
        cell: ({ row }) => (
          <BranchChips
            allBranches={row.original.allBranches}
            branchIds={row.original.branchIds}
            branches={branches}
          />
        ),
      },
      {
        id: "status",
        header: t("users.columns.status"),
        cell: ({ row }) => <UserStatusBadge status={row.original.status} />,
      },
      {
        id: "lastLogin",
        header: t("users.columns.lastLogin"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {row.original.lastLoginAt ? formatDate(row.original.lastLoginAt) : t("users.never")}
          </span>
        ),
      },
    ];
    if (mayUpdate || mayDeactivate) {
      cols.push({
        id: "actions",
        header: () => <span className="sr-only">{t("users.columns.actions")}</span>,
        cell: ({ row }) => {
          const u = row.original;
          const actions: RowAction[] = [];
          if (mayUpdate && u.status === "active") {
            actions.push(
              {
                label: t("users.actions.changeRole"),
                icon: ShieldCheck,
                onSelect: () => onRole(u),
              },
              {
                label: t("users.actions.changeBranches"),
                icon: GitBranch,
                onSelect: () => onBranches(u),
              },
            );
          }
          if (mayDeactivate) {
            const active = u.status === "active";
            actions.push({
              label: t(active ? "users.actions.deactivate" : "users.actions.reactivate"),
              icon: active ? Power : RotateCcw,
              onSelect: () => onStatus(u),
            });
          }
          return <RowActionsMenu label={t("users.columns.actions")} actions={actions} />;
        },
      });
    }
    return cols;
  }, [t, pick, formatDate, mayUpdate, mayDeactivate, branches, onRole, onBranches, onStatus]);
}
