import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/i18n-provider";

/** Cached rows and open dialogs stay mounted while a failed refresh can be retried. */
export function LoadNotice({ title, onRetry }: { title: string; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
      <AlertCircle className="size-4 shrink-0" />
      <span>{title}</span>
      <Button variant="ghost" size="sm" onClick={onRetry}>
        {t("common.tryAgain")}
      </Button>
    </div>
  );
}
