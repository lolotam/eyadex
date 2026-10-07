import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorCodeOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { StatusPanel } from "./status-panel";

/** HTTP mode: the session could not be read (network, server); say so and offer a retry. */
export function SessionErrorPanel({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <StatusPanel
      icon={AlertCircle}
      title={t("auth.sessionLoadError")}
      body={t(`errors.${errorCodeOf(error)}`)}
      action={<Button onClick={onRetry}>{t("common.tryAgain")}</Button>}
    />
  );
}
