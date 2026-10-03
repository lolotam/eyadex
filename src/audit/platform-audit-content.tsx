import { useState } from "react";
import {
  PLATFORM_AUDIT_TIME_ZONE,
  platformAuditEntitySchema,
  platformAuditSourceSchema,
  type PlatformAuditEntity,
  type PlatformAuditItem,
} from "@contracts/audit";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { PageHeader } from "@/shared/shell/page-header";
import { FilterSelect } from "@/shared/table/filter-select";
import { useCursorPages } from "@/shared/table/use-cursor-pages";
import { AuditDetailDialog } from "./audit-detail-dialog";
import { AuditListBody } from "./audit-list-body";
import { usePlatformAudit, usePlatformAuditClinics } from "./audit-queries";
import { PLATFORM_AUDIT_ACTIONS } from "@contracts/audit";
import { AuditToolbar, type AuditFilterValues } from "./audit-toolbar";
import { useAuditColumns } from "./use-audit-columns";

const PAGE_SIZE = 15;
// Patient actions are never offered here; the API also never returns them.
const PLATFORM_ACTIONS = PLATFORM_AUDIT_ACTIONS;
type Source = PlatformAuditItem["source"];

export function PlatformAuditContent() {
  const { t, tDynamic, pick } = useI18n();
  const pages = useCursorPages();
  const [filters, setFilters] = useState<AuditFilterValues>({
    actor: "",
    action: null,
    from: null,
    to: null,
  });
  const [entity, setEntity] = useState<PlatformAuditEntity | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [clinicId, setClinicId] = useState<string | null>(null);
  const clinics = usePlatformAuditClinics();
  const [selected, setSelected] = useState<PlatformAuditItem | null>(null);
  const list = usePlatformAudit({
    cursor: pages.cursor,
    limit: PAGE_SIZE,
    ...filters,
    entity,
    source,
    clinicId,
  });
  const columns = useAuditColumns<PlatformAuditItem>(PLATFORM_AUDIT_TIME_ZONE, true);
  const filtered = Boolean(
    filters.actor || filters.action || filters.from || filters.to || entity || source || clinicId,
  );

  return (
    <div>
      <PageHeader title={t("audit.platformTitle")} subtitle={t("audit.platformSubtitle")} />
      <AuditToolbar
        value={filters}
        actions={PLATFORM_ACTIONS}
        onChange={(next) => {
          setFilters(next);
          pages.reset();
        }}
      >
        <FilterSelect
          value={entity}
          label={t("audit.columns.entity")}
          anyLabel={t("audit.filters.anyEntity")}
          options={platformAuditEntitySchema.options.map((e) => ({
            value: e,
            label: tDynamic(`audit.entities.${e}`),
          }))}
          onChange={(v) => {
            setEntity(v ? platformAuditEntitySchema.parse(v) : null);
            pages.reset();
          }}
        />
        <FilterSelect
          value={clinicId}
          label={t("audit.columns.clinic")}
          anyLabel={t("audit.filters.anyClinic")}
          options={(clinics.data ?? []).map((c) => ({
            value: c.id,
            label: pick(c.nameAr, c.nameEn),
          }))}
          onChange={(v) => {
            setClinicId(v);
            pages.reset();
          }}
        />
        <FilterSelect
          value={source}
          label={t("audit.columns.source")}
          anyLabel={t("audit.filters.anySource")}
          options={platformAuditSourceSchema.options.map((s) => ({
            value: s,
            label: t(`audit.sources.${s}`),
          }))}
          onChange={(v) => {
            setSource(v ? platformAuditSourceSchema.parse(v) : null);
            pages.reset();
          }}
        />
      </AuditToolbar>
      <p className="mb-3 text-xs text-muted-foreground">
        {t("audit.timeZoneNote", { zone: PLATFORM_AUDIT_TIME_ZONE })}
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
      <AuditDetailDialog
        entry={selected}
        timeZone={PLATFORM_AUDIT_TIME_ZONE}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
