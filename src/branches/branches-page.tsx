import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Edit3, MoreHorizontal, Plus, Power, RotateCcw, Search } from "lucide-react";
import { branchStatusSchema, type Branch, type BranchStatus } from "@contracts/organization";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorCodeOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { can } from "@/shared/permissions/can";
import { RequirePermission } from "@/shared/permissions/require-permission";
import { useSession } from "@/shared/persona/persona-provider";
import { PageHeader } from "@/shared/shell/page-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { CursorPager } from "@/shared/table/cursor-pager";
import { DataTable } from "@/shared/table/data-table";
import { useCursorPages } from "@/shared/table/use-cursor-pages";
import { BranchFormSheet } from "./branch-form-sheet";
import { useBranchList } from "./branch-queries";
import { BranchStatusBadge } from "./branch-status-badge";
import { BranchStatusDialog } from "./branch-status-dialog";

const PAGE_SIZE = 10;
const ANY = "any";

export function BranchesPage() {
  return (
    <RequirePermission resource="branches">
      <BranchesContent />
    </RequirePermission>
  );
}

function BranchesContent() {
  const { t, pick } = useI18n();
  const { session } = useSession();
  const pages = useCursorPages();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<BranchStatus | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [statusTarget, setStatusTarget] = useState<Branch | null>(null);
  const list = useBranchList({ cursor: pages.cursor, limit: PAGE_SIZE, search, status });
  const permissions = session?.permissions ?? [];
  const mayCreate = can(permissions, "create", "branches");
  const mayUpdate = can(permissions, "update", "branches");
  const mayDeactivate = can(permissions, "deactivate", "branches");
  const usage = list.data?.usage;

  const columns = useMemo<ColumnDef<Branch, unknown>[]>(() => {
    const values: ColumnDef<Branch, unknown>[] = [
      {
        id: "name", header: t("branches.columns.name"), cell: ({ row }) => (
          <div className="min-w-36">
            <div className="font-medium">{pick(row.original.nameAr, row.original.nameEn)}</div>
            <div className="text-xs text-muted-foreground">{pick(row.original.nameEn, row.original.nameAr)}</div>
          </div>
        ),
      },
      { id: "address", header: t("branches.columns.address"), cell: ({ row }) => <span className="block min-w-40 max-w-64 text-sm">{row.original.address || "—"}</span> },
      { id: "phone", header: t("branches.columns.phone"), cell: ({ row }) => <span className="whitespace-nowrap" dir="ltr">{row.original.phone || "—"}</span> },
      { id: "status", header: t("branches.columns.status"), cell: ({ row }) => <BranchStatusBadge active={row.original.isActive} /> },
    ];
    if (mayUpdate || mayDeactivate) {
      values.push({
        id: "actions", header: () => <span className="sr-only">{t("branches.columns.actions")}</span>,
        cell: ({ row }) => (
          <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={t("branches.columns.actions")}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {mayUpdate && <DropdownMenuItem onClick={() => { setEditing(row.original); setFormOpen(true); }}><Edit3 className="size-4" />{t("common.edit")}</DropdownMenuItem>}
                {mayDeactivate && (
                  <DropdownMenuItem onClick={() => setStatusTarget(row.original)}>
                    {row.original.isActive ? <Power className="size-4" /> : <RotateCcw className="size-4" />}
                    {t(row.original.isActive ? "branches.deactivate" : "branches.reactivate")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      });
    }
    return values;
  }, [mayDeactivate, mayUpdate, pick, t]);

  if (list.isError) {
    return <StatusPanel title={t("branches.loadError")} body={t(`errors.${errorCodeOf(list.error)}`)} action={<Button onClick={() => void list.refetch()}>{t("common.tryAgain")}</Button>} />;
  }

  return (
    <div>
      <PageHeader
        title={t("branches.title")}
        subtitle={t("branches.subtitle")}
        actions={<div className="flex flex-wrap items-center justify-end gap-3"><span className="rounded-md border bg-card px-3 py-2 text-sm font-medium">{t("branches.usage", { active: usage?.active ?? 0, limit: usage?.limit ?? 0 })}</span>{mayCreate && <Button onClick={() => { setEditing(null); setFormOpen(true); }}><Plus className="size-4" />{t("branches.new")}</Button>}</div>}
      />
      {mayCreate && usage && usage.active >= usage.limit && <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{t("branches.limitReached", usage)}</p>}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
        <div className="relative min-w-0 flex-1 basis-60">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="border-transparent bg-muted/60 ps-9 focus-visible:bg-card" placeholder={t("branches.searchPlaceholder")} value={search} onChange={(event) => { setSearch(event.target.value); pages.reset(); }} />
        </div>
        <Select value={status ?? ANY} onValueChange={(value) => { setStatus(value === ANY ? null : branchStatusSchema.parse(value)); pages.reset(); }}>
          <SelectTrigger className="w-full bg-card sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={ANY}>{t("branches.anyStatus")}</SelectItem>{branchStatusSchema.options.map((value) => <SelectItem key={value} value={value}>{t(`common.${value}`)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="overflow-x-auto"><div className="min-w-[720px]"><DataTable columns={columns} data={list.data?.items ?? []} isLoading={list.isLoading} /></div></div>
      <CursorPager count={list.data?.items.length ?? 0} total={list.data?.total ?? 0} canPrevious={pages.canPrevious} canNext={Boolean(list.data?.nextCursor)} onPrevious={pages.previous} onNext={() => pages.next(list.data?.nextCursor ?? null)} />
      <BranchFormSheet open={formOpen} branch={editing} onOpenChange={(open) => { setFormOpen(open); if (!open) setEditing(null); }} />
      <BranchStatusDialog branch={statusTarget} onClose={() => setStatusTarget(null)} />
    </div>
  );
}
