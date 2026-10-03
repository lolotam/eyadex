import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { AuditCategory } from "@contracts/audit";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { AuditCategoryBadge } from "./audit-category-badge";
import { formatAuditTime } from "./audit-time";

type Row = {
  at: string;
  actorName: string;
  action: string;
  entity: string;
  category: AuditCategory;
  clinicNameAr?: string | null;
  clinicNameEn?: string | null;
};

export function useAuditColumns<T extends Row>(timeZone: string, showClinic: boolean) {
  const { t, tDynamic, lang, pick } = useI18n();
  return useMemo<ColumnDef<T, unknown>[]>(() => {
    const cols: ColumnDef<T, unknown>[] = [
      {
        id: "at",
        header: t("audit.columns.at"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm tabular-nums">
            {formatAuditTime(row.original.at, lang, timeZone)}
          </span>
        ),
      },
      {
        id: "actor",
        header: t("audit.columns.actor"),
        cell: ({ row }) => <span className="whitespace-nowrap">{row.original.actorName}</span>,
      },
      {
        id: "action",
        header: t("audit.columns.action"),
        cell: ({ row }) => (
          <span className="font-medium">{tDynamic(`audit.actions.${row.original.action}`)}</span>
        ),
      },
      {
        id: "entity",
        header: t("audit.columns.entity"),
        cell: ({ row }) => tDynamic(`audit.entities.${row.original.entity}`),
      },
    ];
    if (showClinic)
      cols.push({
        id: "source",
        header: t("audit.columns.source"),
        cell: ({ row }) =>
          "source" in row.original && row.original.source
            ? tDynamic(`audit.sources.${row.original.source}`)
            : "—",
      });
    if (showClinic)
      cols.push({
        id: "clinic",
        header: t("audit.columns.clinic"),
        cell: ({ row }) =>
          row.original.clinicNameAr
            ? pick(row.original.clinicNameAr, row.original.clinicNameEn ?? "")
            : "—",
      });
    cols.push({
      id: "category",
      header: t("audit.columns.category"),
      cell: ({ row }) => <AuditCategoryBadge category={row.original.category} />,
    });
    return cols;
  }, [t, tDynamic, lang, pick, timeZone, showClinic]);
}
