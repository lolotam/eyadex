import type { AppointmentMonth } from "@eyadex/contracts/appointment-calendar";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { monthCells, WEEKDAY_KEYS } from "./calendar-dates";

type Props = { month: AppointmentMonth; today: string; onOpenDay: (date: string) => void };

/** The Sunday-first month grid: each day its count of live appointments; a click opens that day. */
export function MonthView({ month, today, onOpenDay }: Props) {
  const { t } = useI18n();
  const counts = new Map(month.days.map((d) => [d.date, d.count]));
  return (
    <div className="rounded-lg border bg-card">
      <div className="grid grid-cols-7 border-b">
        {WEEKDAY_KEYS.map((i) => (
          <div key={i} className="p-2 text-center text-xs font-medium text-muted-foreground">
            {t(`appointments.weekdays.${i}`)}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {monthCells(month.month).map((date, i) => {
          if (date === null)
            return <div key={`blank-${i}`} className="min-h-16 border-b border-e" />;
          const count = counts.get(date) ?? 0;
          const day = String(Number(date.slice(8)));
          return (
            <button
              key={date}
              type="button"
              className="flex min-h-16 flex-col items-start gap-1 border-b border-e p-1.5 text-start hover:bg-primary/5 focus-visible:bg-primary/10 focus-visible:outline-none sm:min-h-20 sm:p-2"
              aria-label={t("appointments.month.openDay", { day, count: String(count) })}
              onClick={() => onOpenDay(date)}
            >
              <span
                className={`text-xs ${date === today ? "rounded-sm bg-primary px-1 font-semibold text-primary-foreground" : ""}`}
              >
                {day}
              </span>
              {count > 0 && (
                <span className="rounded-sm border border-primary/30 bg-primary/10 px-1 text-[11px] font-medium">
                  {t("appointments.month.count", { count: String(count) })}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
