import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Link2, Send, XCircle } from "lucide-react";
import type { Invitation } from "@contracts/invitations";
import type { BranchOption } from "@contracts/users";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { BranchChips } from "./branch-chips";
import { InvitationStatusBadge } from "./invitation-status-badge";
import { RowActionsMenu, type RowAction } from "./row-actions-menu";

type Handlers = {
  mayCreate: boolean;
  mayCancel: boolean;
  branches: BranchOption[];
  onResend: (i: Invitation) => void;
  onCancel: (i: Invitation) => void;
  onCopy: (i: Invitation) => void;
};

export function useInvitationColumns(h: Handlers): ColumnDef<Invitation, unknown>[] {
  const { t, pick, formatDate } = useI18n();
  const { mayCreate, mayCancel, branches, onResend, onCancel, onCopy } = h;
  return useMemo(() => {
    const cols: ColumnDef<Invitation, unknown>[] = [
      {
        id: "email",
        header: t("users.columns.email"),
        cell: ({ row }) => (
          <span dir="ltr" className="text-sm font-medium">
            {row.original.email}
          </span>
        ),
      },
      { id: "name", header: t("users.columns.name"), cell: ({ row }) => row.original.fullName },
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
        cell: ({ row }) => <InvitationStatusBadge status={row.original.status} />,
      },
      {
        id: "expires",
        header: t("users.columns.expires"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {formatDate(row.original.expiresAt)}
          </span>
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">{t("users.columns.actions")}</span>,
        cell: ({ row }) => {
          const inv = row.original;
          const open = inv.status === "pending" || inv.status === "expired";
          const actions: RowAction[] = [];
          if (inv.status === "pending")
            actions.push({
              label: t("users.actions.copyLink"),
              icon: Link2,
              onSelect: () => onCopy(inv),
            });
          if (open && mayCreate)
            actions.push({
              label: t("users.actions.resend"),
              icon: Send,
              onSelect: () => onResend(inv),
            });
          if (open && mayCancel)
            actions.push({
              label: t("users.actions.cancel"),
              icon: XCircle,
              onSelect: () => onCancel(inv),
            });
          return <RowActionsMenu label={t("users.columns.actions")} actions={actions} />;
        },
      },
    ];
    return cols;
  }, [t, pick, formatDate, mayCreate, mayCancel, branches, onResend, onCancel, onCopy]);
}
