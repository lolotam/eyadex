import { useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { invitationStatusSchema, type Invitation } from "@eyadex/contracts/invitations";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { can } from "@/shared/permissions/can";
import { usePersona, useSession } from "@/shared/persona/persona-provider";
import { useCursorPages } from "@/shared/table/use-cursor-pages";
import { CancelInvitationDialog } from "./cancel-invitation-dialog";
import { FilterSelect } from "@/shared/table/filter-select";
import { ListBody } from "./list-body";
import { SearchBox } from "@/shared/table/search-box";
import { useInvitationColumns } from "./use-invitation-columns";
import { userErrorMessage } from "./user-error-message";
import { useBranchOptions, useInvitationList, useRefreshUsers } from "./user-queries";

const PAGE_SIZE = 10;

export function InvitationsTab() {
  const api = useApi();
  const { t } = useI18n();
  const { persona } = usePersona();
  const { session } = useSession();
  const refresh = useRefreshUsers();
  const pages = useCursorPages();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Invitation | null>(null);
  const branches = useBranchOptions();
  const list = useInvitationList({
    cursor: pages.cursor,
    limit: PAGE_SIZE,
    search,
    status: status ? invitationStatusSchema.parse(status) : null,
  });
  const resend = useMutation({
    mutationFn: (inv: Invitation) => api.invitations.resend(persona, inv.id),
    onSuccess: () => {
      refresh();
      toast.success(t("users.resent"));
    },
    onError: (error) => {
      const code = errorCodeOf(error);
      const stale = code === "role_inactive" || code === "branch_inactive";
      toast.error(stale ? t("users.resendInvalid") : userErrorMessage(t, error));
    },
  });
  const permissions = session?.permissions ?? [];
  const columns = useInvitationColumns({
    mayCreate: can(permissions, "create", "users"),
    mayCancel: can(permissions, "deactivate", "users"),
    branches: branches.data ?? [],
    onResend: useCallback((inv: Invitation) => resend.mutate(inv), [resend]),
    onCancel: useCallback((inv: Invitation) => setCancelTarget(inv), []),
    onCopy: useCallback(
      (inv: Invitation) => {
        const url = `${window.location.origin}/invite/${inv.token}`;
        void navigator.clipboard
          ?.writeText(url)
          .then(() => toast.success(t("users.linkCopied")))
          .catch(() => toast.message(url));
      },
      [t],
    ),
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
        <SearchBox
          value={search}
          placeholder={t("users.searchPlaceholder")}
          onChange={(v) => {
            setSearch(v);
            pages.reset();
          }}
        />
        <FilterSelect
          label={t("users.columns.status")}
          value={status}
          anyLabel={t("users.anyStatus")}
          options={invitationStatusSchema.options.map((s) => ({
            value: s,
            label: t(`users.invitationStatus.${s}`),
          }))}
          onChange={(v) => {
            setStatus(v);
            pages.reset();
          }}
        />
      </div>
      <ListBody
        columns={columns}
        data={list.data}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle={t("users.emptyInvitationsTitle")}
        emptyBody={t("users.emptyInvitationsBody")}
        pages={pages}
      />
      <CancelInvitationDialog invitation={cancelTarget} onClose={() => setCancelTarget(null)} />
    </div>
  );
}
