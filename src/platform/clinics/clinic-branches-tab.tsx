import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { Branch } from "@contracts/organization";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { DataTable } from "@/shared/table/data-table";
import { useClinicBranches } from "./clinic-queries";

export function ClinicBranchesTab({ clinicId }: { clinicId: string }) {
  const { t, pick } = useI18n();
  const branches = useClinicBranches(clinicId);

  const columns = useMemo<ColumnDef<Branch, unknown>[]>(
    () => [
      { id: "name", header: t("clinics.branchColumns.name"), cell: ({ row }) => <span className="font-medium">{pick(row.original.nameAr, row.original.nameEn)}</span> },
      {
        id: "status",
        header: t("clinics.branchColumns.status"),
        cell: ({ row }) => (
          <Badge variant={row.original.isActive ? "default" : "secondary"}>
            {row.original.isActive ? t("common.active") : t("common.inactive")}
          </Badge>
        ),
      },
    ],
    [t, pick],
  );

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{t("common.readOnly")}</p>
      <DataTable columns={columns} data={branches.data ?? []} isLoading={branches.isLoading} />
    </div>
  );
}
