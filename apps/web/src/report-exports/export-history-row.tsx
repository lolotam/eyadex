import { AlertCircle, Ban, CircleCheck, Clock, Download, Loader2, TimerOff } from "lucide-react";
import type { ReportExport, ReportExportStatus } from "@eyadex/contracts/finance-reports";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useSession } from "@/shared/persona/persona-provider";

const LOOK: Record<
  ReportExportStatus,
  { icon: typeof Clock; variant: "default" | "secondary" | "destructive" | "outline"; spin?: true }
> = {
  queued: { icon: Clock, variant: "outline" },
  running: { icon: Loader2, variant: "outline", spin: true },
  done: { icon: CircleCheck, variant: "secondary" },
  failed: { icon: AlertCircle, variant: "destructive" },
  expired: { icon: TimerOff, variant: "outline" },
  purged: { icon: Ban, variant: "outline" },
};

type Props = {
  row: ReportExport;
  canDownload: boolean;
  pending: boolean;
  unavailable: boolean;
  error: string | null;
  onDownload: (row: ReportExport) => void;
};

/** One requester-owned export: only its public metadata, never its size, filters or contents. */
export function ExportHistoryRow({
  row,
  canDownload,
  pending,
  unavailable,
  error,
  onDownload,
}: Props) {
  const { t, tDynamic, lang } = useI18n();
  const { session } = useSession();
  const formatter = new Intl.DateTimeFormat(lang === "ar" ? "ar-KW" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: session?.clinic?.timezone ?? "Asia/Kuwait",
  });
  const look = LOOK[row.status];
  const Icon = look.icon;
  const report = t(`reportExports.reports.${row.report}`);
  const format = t(`reportExports.formats.${row.format}`);
  const detail = (label: string, value: string, iso?: string) => (
    <div className="flex justify-between gap-3 md:block">
      <dt className="text-xs text-muted-foreground md:sr-only">{label}</dt>
      <dd className="text-sm tabular-nums">{iso ? <time dateTime={iso}>{value}</time> : value}</dd>
    </div>
  );
  return (
    <li
      className="grid gap-2 border-b px-3 py-3 last:border-b-0 md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_5rem_auto] md:items-center md:gap-4"
      data-testid="export-row"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 md:block">
        <span className="font-medium">{report}</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground md:mt-0.5">
          {format}
          <Badge variant={look.variant} className="gap-1.5 whitespace-nowrap">
            <Icon className={look.spin ? "size-3 animate-spin" : "size-3"} aria-hidden />
            {t(`reportExports.statuses.${row.status}`)}
          </Badge>
        </span>
      </div>
      <dl className="contents">
        {detail(
          t("reportExports.created"),
          formatter.format(new Date(row.createdAt)),
          row.createdAt,
        )}
        {row.expiresAt ? (
          detail(
            t("reportExports.expires"),
            formatter.format(new Date(row.expiresAt)),
            row.expiresAt,
          )
        ) : (
          <span className="hidden md:block" />
        )}
        {row.rowCount !== null ? (
          detail(t("reportExports.rows"), String(row.rowCount))
        ) : (
          <span className="hidden md:block" />
        )}
      </dl>
      <div className="flex flex-col items-stretch gap-1 md:items-end">
        {canDownload && !unavailable ? (
          <Button
            type="button"
            size="sm"
            className="min-h-11 gap-1.5 md:min-h-9"
            disabled={pending}
            aria-label={t("reportExports.downloadLabel", { report, format })}
            onClick={() => onDownload(row)}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Download className="size-4" aria-hidden />
            )}
            {pending ? t("reportExports.downloading") : t("reportExports.download")}
          </Button>
        ) : null}
        {error ? (
          <p role="status" className="text-xs text-destructive">
            {unavailable ? t("reportExports.unavailable") : tDynamic(`errors.${error}`)}
          </p>
        ) : null}
      </div>
    </li>
  );
}
