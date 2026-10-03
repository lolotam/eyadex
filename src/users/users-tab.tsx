import { useCallback, useState } from "react";
import { membershipUserStatusSchema, type MembershipUserView } from "@contracts/users";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { can } from "@/shared/permissions/can";
import { useSession } from "@/shared/persona/persona-provider";
import { useCursorPages } from "@/shared/table/use-cursor-pages";
import { ChangeBranchesDialog } from "./change-branches-dialog";
import { ChangeRoleDialog } from "./change-role-dialog";
import { FilterSelect } from "@/shared/table/filter-select";
import { ListBody } from "./list-body";
import { SearchBox } from "@/shared/table/search-box";
import { useUserColumns } from "./use-user-columns";
import { useBranchOptions, useRoleOptions, useUserList } from "./user-queries";
import { UserStatusDialog } from "./user-status-dialog";

const PAGE_SIZE = 10;

export function UsersTab() {
  const { t, pick } = useI18n();
  const { session } = useSession();
  const pages = useCursorPages();
  const [search, setSearch] = useState("");
  const [roleId, setRoleId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [roleTarget, setRoleTarget] = useState<MembershipUserView | null>(null);
  const [branchTarget, setBranchTarget] = useState<MembershipUserView | null>(null);
  const [statusTarget, setStatusTarget] = useState<MembershipUserView | null>(null);
  const roles = useRoleOptions();
  const branches = useBranchOptions();
  const list = useUserList({
    cursor: pages.cursor,
    limit: PAGE_SIZE,
    search,
    roleId,
    branchId,
    status: status ? membershipUserStatusSchema.parse(status) : null,
  });
  const permissions = session?.permissions ?? [];
  const columns = useUserColumns({
    mayUpdate: can(permissions, "update", "users"),
    mayDeactivate: can(permissions, "deactivate", "users"),
    branches: branches.data ?? [],
    onRole: useCallback((u: MembershipUserView) => setRoleTarget(u), []),
    onBranches: useCallback((u: MembershipUserView) => setBranchTarget(u), []),
    onStatus: useCallback((u: MembershipUserView) => setStatusTarget(u), []),
  });
  const withReset =
    <V,>(setter: (v: V) => void) =>
    (v: V) => {
      setter(v);
      pages.reset();
    };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
        <SearchBox
          value={search}
          placeholder={t("users.searchPlaceholder")}
          onChange={withReset(setSearch)}
        />
        <FilterSelect
          label={t("users.columns.role")}
          value={roleId}
          anyLabel={t("users.anyRole")}
          options={(roles.data ?? []).map((r) => ({
            value: r.id,
            label: pick(r.nameAr, r.nameEn),
          }))}
          onChange={withReset(setRoleId)}
        />
        <FilterSelect
          label={t("users.columns.branches")}
          value={branchId}
          anyLabel={t("users.anyBranch")}
          options={(branches.data ?? []).map((b) => ({
            value: b.id,
            label: pick(b.nameAr, b.nameEn),
          }))}
          onChange={withReset(setBranchId)}
        />
        <FilterSelect
          label={t("users.columns.status")}
          value={status}
          anyLabel={t("users.anyStatus")}
          options={membershipUserStatusSchema.options.map((s) => ({
            value: s,
            label: t(`users.status.${s}`),
          }))}
          onChange={withReset(setStatus)}
        />
      </div>
      <ListBody
        columns={columns}
        data={list.data}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle={t("users.emptyUsersTitle")}
        emptyBody={t("users.emptyUsersBody")}
        pages={pages}
      />
      <ChangeRoleDialog user={roleTarget} onClose={() => setRoleTarget(null)} />
      <ChangeBranchesDialog user={branchTarget} onClose={() => setBranchTarget(null)} />
      <UserStatusDialog user={statusTarget} onClose={() => setStatusTarget(null)} />
    </div>
  );
}
