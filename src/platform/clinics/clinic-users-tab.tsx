import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { MemberView } from "@contracts/organization";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { DataTable } from "@/shared/table/data-table";
import { useClinicBranches, useClinicMembers } from "./clinic-queries";

export function ClinicUsersTab({ clinicId }: { clinicId: string }) {
  const { t, pick } = useI18n();
  const members = useClinicMembers(clinicId);
  const branches = useClinicBranches(clinicId);

  const columns = useMemo<ColumnDef<MemberView, unknown>[]>(() => {
    const branchName = (id: string) => {
      const b = branches.data?.find((x) => x.id === id);
      return b ? pick(b.nameAr, b.nameEn) : "";
    };
    return [
      { id: "name", header: t("clinics.members.name"), cell: ({ row }) => <span className="font-medium">{row.original.fullName}</span> },
      { id: "email", header: t("clinics.members.email"), cell: ({ row }) => <span dir="ltr">{row.original.email}</span> },
      { id: "role", header: t("clinics.members.role"), cell: ({ row }) => pick(row.original.roleNameAr, row.original.roleNameEn) },
      {
        id: "branches",
        header: t("clinics.members.branches"),
        cell: ({ row }) => (row.original.allBranches ? t("clinics.members.allBranches") : row.original.branchIds.map(branchName).join("، ")),
      },
      {
        id: "status",
        header: t("clinics.members.status"),
        cell: ({ row }) => (
          <Badge variant={row.original.status === "active" ? "default" : "secondary"}>
            {t(`clinics.memberStatus.${row.original.status}`)}
          </Badge>
        ),
      },
    ];
  }, [t, pick, branches.data]);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{t("common.readOnly")}</p>
      <DataTable columns={columns} data={members.data ?? []} isLoading={members.isLoading} />
    </div>
  );
}
