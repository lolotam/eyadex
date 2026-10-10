import { useCallback, useState } from "react";
import { AlertCircle, ListChecks, Plus } from "lucide-react";
import { serviceStatusSchema, type ClinicService } from "@eyadex/contracts/services";
import { Button } from "@/components/ui/button";
import { errorCodeOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { can } from "@/shared/permissions/can";
import { useSession } from "@/shared/persona/persona-provider";
import { SectionHeader } from "@/shared/shell/section-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { CursorPager } from "@/shared/table/cursor-pager";
import { DataTable } from "@/shared/table/data-table";
import { FilterSelect } from "@/shared/table/filter-select";
import { useCursorPages } from "@/shared/table/use-cursor-pages";
import { ServiceFormDialog } from "./service-form-dialog";
import { useServiceList } from "./service-queries";
import { ServiceStatusDialog } from "./service-status-dialog";
import { useServiceColumns } from "./use-service-columns";

const PAGE_SIZE = 20;

export function ServicesContent() {
  const { t } = useI18n();
  const { session } = useSession();
  const pages = useCursorPages();
  const [status, setStatus] = useState<string | null>("active");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ClinicService | null>(null);
  const [statusTarget, setStatusTarget] = useState<ClinicService | null>(null);
  const permissions = session?.permissions ?? [];
  const list = useServiceList({
    cursor: pages.cursor,
    limit: PAGE_SIZE,
    status: status ? serviceStatusSchema.parse(status) : null,
  });
  const columns = useServiceColumns({
    mayUpdate: can(permissions, "update", "services"),
    mayDeactivate: can(permissions, "deactivate", "services"),
    onEdit: useCallback((s: ClinicService) => {
      setEditing(s);
      setFormOpen(true);
    }, []),
    onStatus: useCallback((s: ClinicService) => setStatusTarget(s), []),
  });

  if (list.isError) {
    return (
      <StatusPanel
        icon={AlertCircle}
        title={t("services.loadError")}
        body={t(`errors.${errorCodeOf(list.error)}`)}
        action={<Button onClick={() => void list.refetch()}>{t("common.tryAgain")}</Button>}
      />
    );
  }

  const items = list.data?.items ?? [];
  return (
    <div>
      <SectionHeader
        title={t("services.title")}
        subtitle={t("services.subtitle")}
        actions={
          can(permissions, "create", "services") && (
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4" />
              {t("services.new")}
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
        <FilterSelect
          label={t("services.columns.status")}
          value={status}
          anyLabel={t("services.anyStatus")}
          options={serviceStatusSchema.options.map((s) => ({
            value: s,
            label: t(`services.status.${s}`),
          }))}
          onChange={(value) => {
            setStatus(value);
            pages.reset();
          }}
        />
      </div>
      {!list.isLoading && items.length === 0 ? (
        <StatusPanel icon={ListChecks} title={t("services.empty")} body={t("services.emptyBody")} />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            <DataTable
              columns={columns}
              data={items}
              isLoading={list.isLoading}
              stickyEndColumnId="actions"
            />
          </div>
        </div>
      )}
      <CursorPager
        count={items.length}
        total={list.data?.total ?? 0}
        canPrevious={pages.canPrevious}
        canNext={Boolean(list.data?.nextCursor)}
        onPrevious={pages.previous}
        onNext={() => pages.next(list.data?.nextCursor ?? null)}
      />
      <ServiceFormDialog
        open={formOpen}
        service={editing}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
      />
      <ServiceStatusDialog service={statusTarget} onClose={() => setStatusTarget(null)} />
    </div>
  );
}
