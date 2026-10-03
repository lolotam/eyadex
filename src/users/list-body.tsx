import type { ColumnDef } from "@tanstack/react-table";
import { AlertCircle, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { StatusPanel } from "@/shared/shell/status-panel";
import { CursorPager } from "@/shared/table/cursor-pager";
import { DataTable } from "@/shared/table/data-table";
import { userErrorMessage } from "./user-error-message";

type Pages = { canPrevious: boolean; previous: () => void; next: (c: string | null) => void };

/** Loading, error, empty and table + cursor pager for one users-area list. */
export function ListBody<T>({
  columns,
  data,
  isLoading,
  error,
  onRetry,
  emptyTitle,
  emptyBody,
  pages,
}: {
  columns: ColumnDef<T, unknown>[];
  data: { items: T[]; total: number; nextCursor: string | null } | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  emptyTitle: string;
  emptyBody: string;
  pages: Pages;
}) {
  const { t } = useI18n();
  if (error) {
    return (
      <StatusPanel
        icon={AlertCircle}
        title={t("users.loadError")}
        body={userErrorMessage(t, error)}
        action={<Button onClick={onRetry}>{t("common.tryAgain")}</Button>}
      />
    );
  }
  if (!isLoading && data && data.items.length === 0 && !pages.canPrevious) {
    return <StatusPanel icon={Inbox} title={emptyTitle} body={emptyBody} />;
  }
  return (
    <>
      <div className="overflow-x-auto">
        <div className="min-w-[860px]">
          <DataTable columns={columns} data={data?.items ?? []} isLoading={isLoading} />
        </div>
      </div>
      <CursorPager
        count={data?.items.length ?? 0}
        total={data?.total ?? 0}
        canPrevious={pages.canPrevious}
        canNext={Boolean(data?.nextCursor)}
        onPrevious={pages.previous}
        onNext={() => pages.next(data?.nextCursor ?? null)}
      />
    </>
  );
}
