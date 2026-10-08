import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Search } from "lucide-react";
import {
  clinicStatusSchema,
  specialtySchema,
  type ClinicListItem,
  type ClinicStatus,
  type Specialty,
} from "@eyadex/contracts/clinics";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { PageHeader } from "@/shared/shell/page-header";
import { CursorPager } from "@/shared/table/cursor-pager";
import { DataTable } from "@/shared/table/data-table";
import { useCursorPages } from "@/shared/table/use-cursor-pages";
import { ClinicStatusBadge } from "./clinic-status-badge";
import { useClinicList } from "./clinic-queries";
import { expiryFlagOf } from "./expiry-flag";

const PAGE_SIZE = 10;
const ANY = "any";

export function ClinicsListPage() {
  const { t, pick, formatDate } = useI18n();
  const navigate = useNavigate();
  const pages = useCursorPages();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ClinicStatus | null>(null);
  const [specialty, setSpecialty] = useState<Specialty | null>(null);

  const list = useClinicList({ cursor: pages.cursor, limit: PAGE_SIZE, search, status, specialty });

  const columns = useMemo<ColumnDef<ClinicListItem, unknown>[]>(
    () => [
      {
        id: "name",
        header: t("clinics.columns.name"),
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{pick(row.original.nameAr, row.original.nameEn)}</div>
            <div className="text-xs text-muted-foreground" dir="ltr">
              {row.original.slug}
            </div>
          </div>
        ),
      },
      {
        id: "specialty",
        header: t("clinics.columns.specialty"),
        cell: ({ row }) => t(`specialty.${row.original.specialty}`),
      },
      {
        id: "status",
        header: t("clinics.columns.status"),
        cell: ({ row }) => <ClinicStatusBadge status={row.original.status} />,
      },
      {
        id: "expires",
        header: t("clinics.columns.expiresAt"),
        cell: ({ row }) => {
          const flag = expiryFlagOf(row.original.expiresAt, Date.now());
          return (
            <div className="flex min-w-24 flex-col items-start gap-1 whitespace-nowrap">
              <span>{formatDate(row.original.expiresAt)}</span>
              {flag && (
                <Badge variant="outline" className="border-destructive/40 text-destructive">
                  {t(flag === "expired" ? "clinics.expired" : "clinics.expiringSoon")}
                </Badge>
              )}
            </div>
          );
        },
      },
      {
        id: "users",
        header: t("clinics.columns.users"),
        cell: ({ row }) => `${row.original.usersCount} / ${row.original.maxUsers}`,
      },
      {
        id: "branches",
        header: t("clinics.columns.branches"),
        cell: ({ row }) => `${row.original.branchesCount} / ${row.original.maxBranches}`,
      },
    ],
    [t, pick, formatDate],
  );

  return (
    <div>
      <PageHeader
        title={t("clinics.title")}
        subtitle={t("clinics.subtitle")}
        actions={
          <Button asChild>
            <Link to="/platform/clinics/new">
              <Plus className="size-4" />
              {t("clinics.new")}
            </Link>
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="border-transparent bg-muted/60 ps-9 focus-visible:bg-card"
            placeholder={t("clinics.searchPlaceholder")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              pages.reset();
            }}
          />
        </div>
        <Select
          value={status ?? ANY}
          onValueChange={(v) => {
            setStatus(v === ANY ? null : clinicStatusSchema.parse(v));
            pages.reset();
          }}
        >
          <SelectTrigger className="w-44 bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t("clinics.anyStatus")}</SelectItem>
            {clinicStatusSchema.options.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`clinicStatus.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={specialty ?? ANY}
          onValueChange={(v) => {
            setSpecialty(v === ANY ? null : specialtySchema.parse(v));
            pages.reset();
          }}
        >
          <SelectTrigger className="w-44 bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t("clinics.anySpecialty")}</SelectItem>
            {specialtySchema.options.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`specialty.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DataTable
        columns={columns}
        data={list.data?.items ?? []}
        isLoading={list.isLoading}
        onRowClick={(c) =>
          void navigate({ to: "/platform/clinics/$clinicId", params: { clinicId: c.id } })
        }
      />
      <CursorPager
        count={list.data?.items.length ?? 0}
        total={list.data?.total ?? 0}
        canPrevious={pages.canPrevious}
        canNext={Boolean(list.data?.nextCursor)}
        onPrevious={pages.previous}
        onNext={() => pages.next(list.data?.nextCursor ?? null)}
      />
    </div>
  );
}
