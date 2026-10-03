import type { ColumnDef } from "@tanstack/react-table";
import { AlertCircle, ScrollText } from "lucide-react";
import type { Page } from "@eyadex/contracts/common";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { StatusPanel } from "@/shared/shell/status-panel";
import { CursorPager } from "@/shared/table/cursor-pager";
import { DataTable } from "@/shared/table/data-table";

type Props<T> = {
  columns: ColumnDef<T, unknown>[];
  page: Page<T> | undefined;
  isLoading: boolean;
  isError: boolean;
  filtered: boolean;
  onRetry: () => void;
  onRowClick: (row: T) => void;
  pages: { canPrevious: boolean; previous: () => void; next: (c: string | null) => void };
};

/** Loading, error, empty, and the table with its cursor pager, for either audit list. */
export function AuditListBody<T>(props: Props<T>) {
  const { t } = useI18n();
  const { page, isLoading, isError, filtered, pages } = props;
  if (isError)
    return (
      <StatusPanel
        icon={AlertCircle}
        title={t("audit.loadError")}
        body={t("common.tryAgain")}
        action={
          <Button variant="outline" onClick={props.onRetry}>
            {t("common.retry")}
          </Button>
        }
      />
    );
  const items = page?.items ?? [];
  if (!isLoading && items.length === 0)
    return (
      <StatusPanel
        icon={ScrollText}
        title={t(filtered ? "audit.emptyFiltered" : "audit.empty")}
        body={t("audit.emptyBody")}
      />
    );
  return (
    <>
      <DataTable
        columns={props.columns}
        data={items}
        isLoading={isLoading}
        onRowClick={props.onRowClick}
        minWidthClass="min-w-[760px]"
      />
      <CursorPager
        count={items.length}
        total={page?.total ?? 0}
        canPrevious={pages.canPrevious}
        canNext={Boolean(page?.nextCursor)}
        onPrevious={pages.previous}
        onNext={() => pages.next(page?.nextCursor ?? null)}
      />
    </>
  );
}
