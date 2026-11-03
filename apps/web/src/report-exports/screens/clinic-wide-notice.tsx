import { Info } from "lucide-react";
import { useI18n } from "@/shared/i18n/i18n-provider";

type Props = { variant: "banner" | "inline" };

/**
 * R6's exception (owner decision 2026-10-27): the numbers are the current clinic-wide credit, not
 * the selected period's. Shown above the list and beside the export button so it cannot be missed.
 */
export function ClinicWideNotice({ variant }: Props) {
  const { t } = useI18n();
  return (
    <p
      role="note"
      data-testid={`clinic-wide-notice-${variant}`}
      className={
        variant === "banner"
          ? "flex items-start gap-2 rounded-md border border-primary/40 bg-primary/10 p-3 text-sm font-medium text-foreground"
          : "flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-foreground"
      }
    >
      <Info
        className={variant === "banner" ? "mt-0.5 size-4 shrink-0 text-primary" : "size-3.5 shrink-0 text-primary"}
        aria-hidden
      />
      {t("financeReports.patientCredit.notice")}
    </p>
  );
}
