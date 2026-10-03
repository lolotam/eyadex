import { Loader2 } from "lucide-react";
import { useI18n } from "@/shared/i18n/i18n-provider";

export function LoadingBlock() {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {t("common.loading")}
    </div>
  );
}
