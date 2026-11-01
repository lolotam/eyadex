import { AlertCircle, FileX, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { ExportHistoryRow } from "./export-history-row";
import { useExportDownload } from "./use-export-download";
import { useExportHistory } from "./use-export-history";

/** The requester's own export history; the hooks and adapters decide every access question. */
export function ExportHistory() {
  const { t, tDynamic } = useI18n();
  const history = useExportHistory();
  const download = useExportDownload(history.items, history.refresh);
  const rows = history.items;
  const errorBox = (code: string, retry: () => unknown, label?: string) => (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 px-3 py-2 text-sm"
    >
      <span className="flex items-center gap-2 text-destructive">
        <AlertCircle className="size-4 shrink-0" aria-hidden />
        {label ?? tDynamic(`errors.${code}`)}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11 md:min-h-9"
        onClick={() => void retry()}
      >
        {t("reportExports.retry")}
      </Button>
    </div>
  );
  return (
    <section aria-labelledby="report-exports-title" className="flex flex-col gap-3">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="report-exports-title" className="text-base font-semibold">
            {t("reportExports.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("reportExports.subtitle")}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 gap-1.5 md:min-h-9"
          disabled={history.isRefreshing || history.isLoading}
          onClick={() => void history.refresh()}
        >
          <RefreshCw
            className={history.isRefreshing ? "size-4 animate-spin" : "size-4"}
            aria-hidden
          />
          {history.isRefreshing ? t("reportExports.refreshing") : t("reportExports.refresh")}
        </Button>
      </header>
      {history.error ? errorBox(history.error, history.retry) : null}
      {history.isLoading && rows.length === 0 ? (
        <p aria-busy="true" className="text-sm text-muted-foreground">
          {t("reportExports.loading")}
        </p>
      ) : rows.length === 0 && !history.error ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileX className="size-4" aria-hidden />
          {t("reportExports.empty")}
        </p>
      ) : rows.length > 0 ? (
        <>
          <ul className="rounded-md border bg-card" aria-labelledby="report-exports-title">
            {rows.map((row) => (
              <ExportHistoryRow
                key={row.id}
                row={row}
                canDownload={download.canDownload(row)}
                pending={download.pending.has(row.id)}
                unavailable={download.unavailable.has(row.id)}
                error={download.errors[row.id] ?? null}
                onDownload={(item) => void download.download(item)}
              />
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {t("reportExports.loaded", { shown: rows.length, total: history.total })}
          </p>
        </>
      ) : null}
      {history.pageError
        ? errorBox(history.pageError, history.loadMore, t("reportExports.pageError"))
        : null}
      {history.hasMore && !history.pageError ? (
        <Button
          type="button"
          variant="outline"
          className="min-h-11 self-center"
          disabled={history.isLoadingMore}
          onClick={() => void history.loadMore()}
        >
          {history.isLoadingMore ? t("reportExports.loadingMore") : t("reportExports.loadMore")}
        </Button>
      ) : null}
    </section>
  );
}
