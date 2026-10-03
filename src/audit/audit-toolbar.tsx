import type { ReactNode } from "react";
import { AUDIT_ACTIONS } from "@contracts/audit";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { FilterSelect } from "@/shared/table/filter-select";
import { SearchBox } from "@/shared/table/search-box";

export type AuditFilterValues = {
  actor: string;
  action: string | null;
  from: string | null;
  to: string | null;
};

type Props = {
  value: AuditFilterValues;
  /** Actions offered in the action filter (the platform never offers patient ones). */
  actions: readonly string[];
  onChange: (next: AuditFilterValues) => void;
  children?: ReactNode;
};

export const ALL_AUDIT_ACTIONS: readonly string[] = AUDIT_ACTIONS;

export function AuditToolbar({ value, actions, onChange, children }: Props) {
  const { t, tDynamic } = useI18n();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
      <SearchBox
        value={value.actor}
        placeholder={t("audit.filters.actor")}
        onChange={(actor) => onChange({ ...value, actor })}
      />
      <FilterSelect
        value={value.action}
        label={t("audit.columns.action")}
        anyLabel={t("audit.filters.anyAction")}
        options={actions.map((a) => ({ value: a, label: tDynamic(`audit.actions.${a}`) }))}
        onChange={(action) => onChange({ ...value, action })}
      />
      {children}
      <label className="flex w-full items-center gap-2 text-sm sm:w-auto">
        <span className="shrink-0 text-muted-foreground">{t("audit.filters.from")}</span>
        <Input
          type="date"
          className="bg-card sm:w-40"
          value={value.from ?? ""}
          max={value.to ?? undefined}
          onChange={(e) => onChange({ ...value, from: e.target.value || null })}
        />
      </label>
      <label className="flex w-full items-center gap-2 text-sm sm:w-auto">
        <span className="shrink-0 text-muted-foreground">{t("audit.filters.to")}</span>
        <Input
          type="date"
          className="bg-card sm:w-40"
          value={value.to ?? ""}
          min={value.from ?? undefined}
          onChange={(e) => onChange({ ...value, to: e.target.value || null })}
        />
      </label>
    </div>
  );
}
