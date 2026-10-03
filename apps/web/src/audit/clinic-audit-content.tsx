import { useState } from "react";
import {
  auditCategorySchema,
  type AuditCategory,
  type ClinicAuditItem,
} from "@eyadex/contracts/audit";
import { clinicAuditEntitySchema } from "@eyadex/contracts/organization";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useSession } from "@/shared/persona/persona-provider";
import { PageHeader } from "@/shared/shell/page-header";
import { FilterSelect } from "@/shared/table/filter-select";
import { useCursorPages } from "@/shared/table/use-cursor-pages";
import { AuditDetailDialog } from "./audit-detail-dialog";
import { AuditListBody } from "./audit-list-body";
import { useClinicAudit } from "./audit-queries";
import { CLINIC_AUDIT_ACTIONS } from "@eyadex/contracts/audit";
import { AuditToolbar, type AuditFilterValues } from "./audit-toolbar";
import { useAuditColumns } from "./use-audit-columns";

const PAGE_SIZE = 15;
const CLINIC_ACTIONS = CLINIC_AUDIT_ACTIONS;
type Entity = ClinicAuditItem["entity"];

export function ClinicAuditContent() {
  const { t, tDynamic } = useI18n();
  const { session } = useSession();
  const timeZone = session?.clinic?.timezone ?? "Asia/Kuwait";
  const pages = useCursorPages();
  const [filters, setFilters] = useState<AuditFilterValues>({
    actor: "",
    action: null,
    from: null,
    to: null,
  });
  const [entity, setEntity] = useState<Entity | null>(null);
  const [category, setCategory] = useState<AuditCategory | null>(null);
  const [selected, setSelected] = useState<ClinicAuditItem | null>(null);
  const list = useClinicAudit({
    cursor: pages.cursor,
    limit: PAGE_SIZE,
    ...filters,
    entity,
    category,
  });
  const columns = useAuditColumns<ClinicAuditItem>(timeZone, false);
  const filtered = Boolean(
    filters.actor || filters.action || filters.from || filters.to || entity || category,
  );

  return (
    <div>
      <PageHeader title={t("audit.title")} subtitle={t("audit.subtitle")} />
      <AuditToolbar
        value={filters}
        actions={CLINIC_ACTIONS}
        onChange={(next) => {
          setFilters(next);
          pages.reset();
        }}
      >
        <FilterSelect
          value={entity}
          label={t("audit.columns.entity")}
          anyLabel={t("audit.filters.anyEntity")}
          options={clinicAuditEntitySchema.options.map((e) => ({
            value: e,
            label: tDynamic(`audit.entities.${e}`),
          }))}
          onChange={(v) => {
            setEntity(v ? clinicAuditEntitySchema.parse(v) : null);
            pages.reset();
          }}
        />
        <FilterSelect
          value={category}
          label={t("audit.columns.category")}
          anyLabel={t("audit.filters.anyCategory")}
          options={auditCategorySchema.options.map((c) => ({
            value: c,
            label: t(`audit.categories.${c}`),
          }))}
          onChange={(v) => {
            setCategory(v ? auditCategorySchema.parse(v) : null);
            pages.reset();
          }}
        />
      </AuditToolbar>
      <p className="mb-3 text-xs text-muted-foreground">
        {t("audit.timeZoneNote", { zone: timeZone })}
      </p>
      <AuditListBody
        columns={columns}
        page={list.data}
        isLoading={list.isLoading}
        isError={list.isError}
        filtered={filtered}
        onRetry={() => void list.refetch()}
        onRowClick={setSelected}
        pages={pages}
      />
      <AuditDetailDialog entry={selected} timeZone={timeZone} onClose={() => setSelected(null)} />
    </div>
  );
}
