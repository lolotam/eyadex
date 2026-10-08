import { useCallback, useState } from "react";
import { AlertCircle, Plus, ShieldCheck } from "lucide-react";
import type { RoleListItem } from "@eyadex/contracts/roles";
import { Button } from "@/components/ui/button";
import { errorCodeOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useSession } from "@/shared/persona/persona-provider";
import { PageHeader } from "@/shared/shell/page-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { DataTable } from "@/shared/table/data-table";
import { RoleFormDialog } from "./role-form-dialog";
import { useRoleList } from "./role-queries";
import { RoleStatusDialog } from "./role-status-dialog";
import { roleWriteAccess } from "./role-write-access";
import { useRoleColumns } from "./use-role-columns";

export function RolesContent() {
  const { t } = useI18n();
  const { session } = useSession();
  const list = useRoleList();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RoleListItem | null>(null);
  const [statusTarget, setStatusTarget] = useState<RoleListItem | null>(null);
  const permissions = session?.permissions ?? [];
  const { mayCreate, mayUpdate, mayDeactivate } = roleWriteAccess(permissions);
  const onOpen = useCallback((role: RoleListItem) => {
    setEditing(role);
    setFormOpen(true);
  }, []);
  const columns = useRoleColumns({ mayUpdate, mayDeactivate, onOpen, onToggle: setStatusTarget });

  if (list.isError) {
    return (
      <StatusPanel
        icon={AlertCircle}
        title={t("roles.loadError")}
        body={t(`errors.${errorCodeOf(list.error)}`)}
        action={<Button onClick={() => void list.refetch()}>{t("common.tryAgain")}</Button>}
      />
    );
  }

  const roles = list.data ?? [];
  return (
    <div>
      <PageHeader
        title={t("roles.title")}
        subtitle={t("roles.subtitle")}
        actions={
          mayCreate && (
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4" />
              {t("roles.new")}
            </Button>
          )
        }
      />
      {!list.isLoading && roles.length === 0 ? (
        <StatusPanel icon={ShieldCheck} title={t("roles.empty")} body={t("roles.emptyBody")} />
      ) : (
        <DataTable
          columns={columns}
          data={roles}
          isLoading={list.isLoading}
          onRowClick={onOpen}
          minWidthClass="min-w-[640px]"
          stickyEndColumnId="actions"
        />
      )}
      <RoleFormDialog
        open={formOpen}
        role={editing}
        readOnly={editing ? editing.isLocked || !mayUpdate : !mayCreate}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
      />
      <RoleStatusDialog role={statusTarget} onClose={() => setStatusTarget(null)} />
    </div>
  );
}
