import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { Branch } from "@contracts/organization";
import { BranchStatusBadge } from "@/branches/branch-status-badge";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { DataTable } from "@/shared/table/data-table";
import { useClinicBranches } from "./clinic-queries";

export function ClinicBranchesTab({ clinicId }: { clinicId: string }) {
  const { t, pick } = useI18n();
  const branches = useClinicBranches(clinicId);

  const columns = useMemo<ColumnDef<Branch, unknown>[]>(
    () => [
      {
        id: "name", header: t("clinics.branchColumns.name"), cell: ({ row }) => (
          <div><div className="font-medium">{pick(row.original.nameAr, row.original.nameEn)}</div><div className="text-xs text-muted-foreground">{pick(row.original.nameEn, row.original.nameAr)}</div></div>
        ),
      },
      { id: "address", header: t("clinics.branchColumns.address"), cell: ({ row }) => row.original.address || "—" },
      { id: "phone", header: t("clinics.branchColumns.phone"), cell: ({ row }) => <span dir="ltr">{row.original.phone || "—"}</span> },
      {
        id: "status",
        header: t("clinics.branchColumns.status"),
        cell: ({ row }) => (
          <BranchStatusBadge active={row.original.isActive} />
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
