import { useCallback, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, Plus, Users } from "lucide-react";
import {
  patientStatusSchema,
  type PatientListItem,
  type PatientStatus,
} from "@eyadex/contracts/patients";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { can } from "@/shared/permissions/can";
import { useSession } from "@/shared/persona/persona-provider";
import { PageHeader } from "@/shared/shell/page-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { CursorPager } from "@/shared/table/cursor-pager";
import { DataTable } from "@/shared/table/data-table";
import { useCursorPages } from "@/shared/table/use-cursor-pages";
import { FilterSelect } from "@/shared/table/filter-select";
import { SearchBox } from "@/shared/table/search-box";
import { PatientFormDialog } from "./patient-form-dialog";
import { usePatientBranches, usePatientList } from "./patient-queries";
import { PatientStatusDialog } from "./patient-status-dialog";
import { usePatientColumns } from "./use-patient-columns";

const PAGE_SIZE = 10;

export function PatientsContent() {
  const { t, pick } = useI18n();
  const { session } = useSession();
  const navigate = useNavigate();
  const pages = useCursorPages();
  const [q, setQ] = useState("");
  const [branchId, setBranchId] = useState<string | null>(null);
  const [status, setStatus] = useState<PatientStatus | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [statusTarget, setStatusTarget] = useState<PatientListItem | null>(null);
  const list = usePatientList({ cursor: pages.cursor, limit: PAGE_SIZE, q, branchId, status });
  const branches = usePatientBranches("view");
  const permissions = session?.permissions ?? [];
  const mayCreate = can(permissions, "create", "patients");
  const mayArchive = can(permissions, "deactivate", "patients");

  const onOpen = useCallback(
    (p: PatientListItem) =>
      void navigate({ to: "/clinic/patients/$patientId", params: { patientId: p.id } }),
    [navigate],
  );
  const columns = usePatientColumns({ mayArchive, onOpen, onStatus: setStatusTarget });
  const filtered = Boolean(q || branchId || status);
  const items = list.data?.items ?? [];

  let body;
  if (list.isError) {
    body = (
      <StatusPanel
        icon={AlertCircle}
        title={t("patients.loadError")}
        body={t("common.tryAgain")}
        action={
          <Button variant="outline" onClick={() => void list.refetch()}>
            {t("common.retry")}
          </Button>
        }
      />
    );
  } else if (!list.isLoading && items.length === 0 && !filtered) {
    body = <StatusPanel icon={Users} title={t("patients.empty")} body={t("patients.emptyBody")} />;
  } else {
    body = (
      <>
        <DataTable
          columns={columns}
          data={items}
          isLoading={list.isLoading}
          onRowClick={onOpen}
          minWidthClass="min-w-[760px]"
          stickyEndColumnId="actions"
        />
        {!list.isLoading && items.length === 0 && (
          <p className="pt-3 text-center text-sm text-muted-foreground">
            {t("patients.emptyFiltered")}
          </p>
        )}
        <CursorPager
          count={items.length}
          total={list.data?.total ?? 0}
          canPrevious={pages.canPrevious}
          canNext={Boolean(list.data?.nextCursor)}
          onPrevious={pages.previous}
          onNext={() => pages.next(list.data?.nextCursor ?? null)}
        />
      </>
    );
  }

  return (
    <div>
      <PageHeader
        title={t("patients.title")}
        subtitle={t("patients.subtitle")}
        actions={
          mayCreate && (
            <Button onClick={() => setFormOpen(true)}>
              <Plus className="size-4" />
              {t("patients.new")}
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
        <SearchBox
          value={q}
          placeholder={t("patients.searchPlaceholder")}
          onChange={(value) => {
            setQ(value);
            pages.reset();
          }}
        />
        <FilterSelect
          value={branchId}
          label={t("patients.columns.branch")}
          anyLabel={t("patients.anyBranch")}
          options={(branches.data ?? []).map((b) => ({
            value: b.id,
            label: pick(b.nameAr, b.nameEn),
          }))}
          onChange={(value) => {
            setBranchId(value);
            pages.reset();
          }}
        />
        <FilterSelect
          value={status}
          label={t("patients.columns.status")}
          anyLabel={t("patients.anyStatus")}
          options={patientStatusSchema.options.map((s) => ({
            value: s,
            label: t(`patients.status.${s}`),
          }))}
          onChange={(value) => {
            setStatus(value ? patientStatusSchema.parse(value) : null);
            pages.reset();
          }}
        />
      </div>
      {body}
      <PatientFormDialog open={formOpen} patient={null} onOpenChange={setFormOpen} />
      <PatientStatusDialog patient={statusTarget} onClose={() => setStatusTarget(null)} />
    </div>
  );
}
