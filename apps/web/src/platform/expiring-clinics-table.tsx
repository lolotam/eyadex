import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import type { ExpiringClinic } from "@eyadex/contracts/platform";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { DataTable } from "@/shared/table/data-table";
import { ClinicStatusBadge } from "./clinics/clinic-status-badge";

export function ExpiringClinicsTable({ rows }: { rows: ExpiringClinic[] }) {
  const { t, pick, formatDate } = useI18n();
  const columns = useMemo<ColumnDef<ExpiringClinic, unknown>[]>(
    () => [
      {
        id: "clinic",
        header: t("overview.columns.clinic"),
        cell: ({ row }) => (
          <Link
            to="/platform/clinics/$clinicId"
            params={{ clinicId: row.original.id }}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {pick(row.original.nameAr, row.original.nameEn)}
          </Link>
        ),
      },
      {
        id: "status",
        header: t("overview.columns.status"),
        cell: ({ row }) => <ClinicStatusBadge status={row.original.status} />,
      },
      {
        id: "expires",
        header: t("overview.columns.expires"),
        cell: ({ row }) => formatDate(row.original.expiresAt),
      },
      {
        id: "daysLeft",
        header: t("overview.columns.daysLeft"),
        cell: ({ row }) =>
          row.original.daysLeft <= 0
            ? t("overview.today")
            : t("overview.daysLeft", { days: row.original.daysLeft }),
      },
    ],
    [t, pick, formatDate],
  );
  if (rows.length === 0)
    return (
      <p className="rounded-lg border bg-card px-4 py-6 text-sm text-muted-foreground">
        {t("overview.expiringEmpty")}
      </p>
    );
  return <DataTable columns={columns} data={rows} minWidthClass="min-w-[560px]" />;
}
