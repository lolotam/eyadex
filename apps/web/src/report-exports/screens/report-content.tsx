import type { ReactNode } from "react";
import { AlertCircle, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/shared/i18n/i18n-provider";

type Props = {
  loading: boolean;
  error: string | null;
  empty: boolean;
  onRetry: () => void;
  children: ReactNode;
};

/** Loading skeleton, error with retry, empty period, or the report body. */
export function ReportContent({ loading, error, empty, onRetry, children }: Props) {
  const { t, tDynamic } = useI18n();
  if (loading)
    return (
      <div role="status" aria-label={t("financeReports.states.loading")} className="grid gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  if (error !== null) {
    const known = tDynamic(`errors.${error}`);
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-md border bg-card p-4 text-sm"
      >
        <p className="flex items-center gap-2">
          <AlertCircle className="size-4 shrink-0 text-destructive" aria-hidden />
          {known.startsWith("errors.") ? t("financeReports.states.error") : known}
        </p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t("financeReports.states.retry")}
        </Button>
      </div>
    );
  }
  if (empty)
    return (
      <p className="flex items-center gap-2 rounded-md border bg-card p-6 text-sm text-muted-foreground">
        <Inbox className="size-4 shrink-0" aria-hidden />
        {t("financeReports.states.empty")}
      </p>
    );
  return <>{children}</>;
}
