import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, FolderOpen, MoreHorizontal, RotateCcw } from "lucide-react";
import { formatFileNumber, type PatientListItem } from "@contracts/patients";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { PatientStatusBadge } from "./patient-status-badge";

type Options = {
  mayArchive: boolean;
  onOpen: (patient: PatientListItem) => void;
  onStatus: (patient: PatientListItem) => void;
};

export function usePatientColumns({ mayArchive, onOpen, onStatus }: Options) {
  const { t, pick } = useI18n();
  return useMemo<ColumnDef<PatientListItem, unknown>[]>(
    () => [
      {
        id: "fileNumber",
        header: t("patients.columns.fileNumber"),
        cell: ({ row }) => (
          <span className="font-mono text-sm tabular-nums" dir="ltr">
            {formatFileNumber(row.original.fileNumber)}
          </span>
        ),
      },
      {
        id: "name",
        header: t("patients.columns.name"),
        cell: ({ row }) => (
          <div className="min-w-40">
            <div className="font-medium">{row.original.fullName}</div>
            {row.original.civilIdLast4 && (
              <div className="text-xs text-muted-foreground">
                {t("patients.columns.civilId")}{" "}
                <span dir="ltr">••••••••{row.original.civilIdLast4}</span>
              </div>
            )}
          </div>
        ),
      },
      {
        id: "phone",
        header: t("patients.columns.phone"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap" dir="ltr">
            {row.original.phone}
          </span>
        ),
      },
      {
        id: "branch",
        header: t("patients.columns.branch"),
        cell: ({ row }) => pick(row.original.branchNameAr, row.original.branchNameEn),
      },
      {
        id: "status",
        header: t("patients.columns.status"),
        cell: ({ row }) => <PatientStatusBadge status={row.original.status} />,
      },
      {
        id: "actions",
        header: () => <span className="sr-only">{t("patients.columns.actions")}</span>,
        cell: ({ row }) => (
          <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t("patients.columns.actions")}>
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onOpen(row.original)}>
                  <FolderOpen className="size-4" />
                  {t("patients.open")}
                </DropdownMenuItem>
                {mayArchive && row.original.actions.deactivate && (
                  <DropdownMenuItem onSelect={() => onStatus(row.original)}>
                    {row.original.status === "active" ? (
                      <Archive className="size-4" />
                    ) : (
                      <RotateCcw className="size-4" />
                    )}
                    {t(row.original.status === "active" ? "patients.archive" : "patients.restore")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [t, pick, mayArchive, onOpen, onStatus],
  );
}
