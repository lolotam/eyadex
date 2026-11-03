import { useId, useState } from "react";
import { useI18n } from "@/shared/i18n/i18n-provider";

/**
 * A free-text reason, always a React text node (never HTML). The row shows it on one collapsed
 * line; a keyboard-reachable toggle shows the full text with its line breaks.
 */
export function ReasonText({ reason }: { reason: string }) {
  const { t } = useI18n();
  const id = useId();
  const [open, setOpen] = useState(false);
  const collapsed = reason.replace(/\s+/g, " ").trim();
  if (collapsed === "") return <span>{t("financeReports.adjustments.noValue")}</span>;
  return (
    <span className="flex max-w-xs flex-col items-start gap-1">
      <span
        id={id}
        data-testid="reason-text"
        // The text node is always the full reason: normal whitespace folds its line breaks into the one
        // clamped line, and printing (no toggle) shows it whole with its line breaks.
        className={
          open
            ? "whitespace-pre-line break-words"
            : "line-clamp-1 break-all print:line-clamp-none print:whitespace-pre-line print:break-words"
        }
      >
        {reason}
      </span>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring print:hidden"
      >
        {open ? t("financeReports.adjustments.less") : t("financeReports.adjustments.more")}
      </button>
    </span>
  );
}
