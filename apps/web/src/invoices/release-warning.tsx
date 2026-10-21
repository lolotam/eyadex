import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/shared/i18n/i18n-provider";

/** Before a void or an edit that leaves more paid than owed: the excess becomes the patient's credit. */
export function ReleaseWarning() {
  const { t } = useI18n();
  return (
    <p role="alert" className="flex items-start gap-2 rounded-md border bg-muted p-3 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      {t("payments.releaseWarning")}
    </p>
  );
}
