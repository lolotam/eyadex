import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/i18n-provider";

type Props = {
  shown: string;
  total: string;
  testId: string;
  hasMore: boolean;
  loadingMore: boolean;
  moreError: string | null;
  loadMore: () => void;
  retryMore: () => void;
};

/** «عرض X من Y», the print note, «تحميل المزيد» and the retry for the one failed page. */
export function AdjustmentPagesFooter(p: Props) {
  const { t, tDynamic } = useI18n();
  const known = p.moreError ? tDynamic(`errors.${p.moreError}`) : "";
  return (
    <>
      <p className="text-xs text-muted-foreground" data-testid={p.testId}>
        {t("financeReports.outstanding.showing", { shown: p.shown, total: p.total })}
      </p>
      <p className="hidden text-xs print:block">
        {t("financeReports.outstanding.printNote", { shown: p.shown, total: p.total })}
      </p>
      {p.moreError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm print:hidden">
          <AlertCircle className="size-4 shrink-0 text-destructive" aria-hidden />
          {known.startsWith("errors.") ? t("financeReports.outstanding.moreError") : known}
          <Button variant="outline" size="sm" onClick={p.retryMore}>
            {t("financeReports.outstanding.retryMore")}
          </Button>
        </div>
      ) : p.hasMore ? (
        <Button
          variant="outline"
          className="w-fit print:hidden"
          disabled={p.loadingMore}
          onClick={p.loadMore}
        >
          {p.loadingMore
            ? t("financeReports.outstanding.loadingMore")
            : t("financeReports.outstanding.loadMore")}
        </Button>
      ) : null}
    </>
  );
}
