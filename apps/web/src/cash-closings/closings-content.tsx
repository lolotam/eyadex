import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Vault } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorKeyOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { can } from "@/shared/permissions/can";
import { useSession } from "@/shared/persona/persona-provider";
import { PageHeader } from "@/shared/shell/page-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { CursorPager } from "@/shared/table/cursor-pager";
import { DataTable } from "@/shared/table/data-table";
import { FilterSelect } from "@/shared/table/filter-select";
import { useCursorPages } from "@/shared/table/use-cursor-pages";
import { CloseDialog } from "./close-dialog";
import { closableBranches } from "./closing-count";
import { closingKeys, useClosingBranches, useClosingList } from "./closing-queries";
import { useClosingColumns } from "./use-closing-columns";

const PAGE_SIZE = 20;

/** «إقفال الصندوق»: the closing history (branch, days) and, with the create key, the close dialog. */
export function ClosingsContent() {
  const { t, tDynamic, pick } = useI18n();
  const { session } = useSession();
  const permissions = session?.permissions ?? [];
  const pages = useCursorPages();
  const queryClient = useQueryClient();
  // The branch names and the dialog's picker are the payments branch options (owner decision).
  const branches = useClosingBranches(can(permissions, "view", "payments"));
  const [branchId, setBranchId] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [closing, setClosing] = useState(false);
  const list = useClosingList({
    limit: PAGE_SIZE,
    ...(pages.cursor ? { cursor: pages.cursor } : {}),
    ...(branchId ? { branchId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });
  const columns = useClosingColumns(branches.data);
  const filtered = (apply: () => void) => {
    apply();
    pages.reset();
  };
  const closable = session ? closableBranches(session, branches.data ?? []) : [];
  const mayClose = can(permissions, "create", "cash_closings");
  const items = list.data?.items ?? [];
  return (
    <div>
      <PageHeader
        title={t("cashClosings.title")}
        subtitle={t("cashClosings.subtitle")}
        actions={
          mayClose && closable.length > 0 ? (
            <Button onClick={() => setClosing(true)}>
              <Vault className="size-4" />
              {t("cashClosings.close")}
            </Button>
          ) : null
        }
      />
      <div className="mb-4 grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-3">
        <FilterSelect
          label={t("cashClosings.branch")}
          value={branchId}
          anyLabel={t("cashClosings.allBranches")}
          options={(branches.data ?? []).map((b) => ({
            value: b.id,
            label: pick(b.nameAr, b.nameEn),
          }))}
          onChange={(v) => filtered(() => setBranchId(v))}
        />
        <Input
          type="date"
          value={from}
          aria-label={t("cashClosings.from")}
          onChange={(e) => filtered(() => setFrom(e.target.value))}
        />
        <Input
          type="date"
          value={to}
          aria-label={t("cashClosings.to")}
          onChange={(e) => filtered(() => setTo(e.target.value))}
        />
      </div>
      {branches.isError && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive">
          <span>{t("cashClosings.branchesError")}</span>
          <Button size="sm" variant="outline" onClick={() => void branches.refetch()}>
            {t("common.tryAgain")}
          </Button>
        </div>
      )}
      {list.isError ? (
        <StatusPanel
          icon={AlertCircle}
          title={t("cashClosings.loadError")}
          body={tDynamic(`errors.${errorKeyOf(list.error)}`)}
          action={<Button onClick={() => void list.refetch()}>{t("common.tryAgain")}</Button>}
        />
      ) : !list.isLoading && items.length === 0 ? (
        <StatusPanel
          icon={Vault}
          title={t("cashClosings.empty")}
          body={t("cashClosings.emptyBody")}
        />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <DataTable columns={columns} data={items} isLoading={list.isLoading} />
          </div>
        </div>
      )}
      <CursorPager
        count={items.length}
        total={list.data?.total ?? 0}
        canPrevious={!list.isPlaceholderData && pages.canPrevious}
        canNext={!list.isPlaceholderData && Boolean(list.data?.nextCursor)}
        onPrevious={pages.previous}
        onNext={() => pages.next(list.data?.nextCursor ?? null)}
      />
      {closing && (
        <CloseDialog
          open
          onOpenChange={setClosing}
          branches={closable}
          onShowClosed={(branch, day) =>
            filtered(() => {
              setBranchId(branch);
              setFrom(day);
              setTo(day);
              // An already-loaded (empty) page of that filter is fetched again.
              void queryClient.invalidateQueries({ queryKey: [...closingKeys.all, "list"] });
            })
          }
        />
      )}
    </div>
  );
}
