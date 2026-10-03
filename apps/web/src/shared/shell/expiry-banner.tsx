import { CalendarClock } from "lucide-react";
import { useI18n } from "@/shared/i18n/i18n-provider";

/** Story 30: shown while the subscription ends within the platform alert window. */
export function ExpiryBanner({ days }: { days: number }) {
  const { t } = useI18n();
  const text =
    days <= 0
      ? t("expiryBanner.today")
      : days === 1
        ? t("expiryBanner.one")
        : t("expiryBanner.days", { days });
  return (
    <div
      role="status"
      className="mb-6 flex items-start gap-3 rounded-md border border-primary/30 bg-secondary px-4 py-3 text-sm"
    >
      <CalendarClock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <span>{text}</span>
    </div>
  );
}
