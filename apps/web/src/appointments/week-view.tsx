import type { AppointmentWeek } from "@eyadex/contracts/appointment-calendar";
import type { Appointment } from "@eyadex/contracts/appointments";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { gutterDayIndex, isRegularDay, WEEKDAY_KEYS, weekDayAsDay } from "./calendar-dates";
import { hourMarks, PX_PER_MINUTE, visibleRange } from "./day-grid";
import { ProviderColumn } from "./provider-column";

type Props = {
  week: AppointmentWeek;
  onBook: (dayIndex: number, providerId: string, startsAt: string) => void;
  onReschedule: (appointment: Appointment) => void;
  onCancel: (appointment: Appointment) => void;
};

/** The provider week: seven Sunday-first columns on the day's real-minute axis, one shared range. */
export function WeekView({ week, onBook, onReschedule, onCancel }: Props) {
  const { t } = useI18n();
  const days = week.days.map((_, i) => weekDayAsDay(week, i));
  const ranges = days.map(visibleRange);
  const range = {
    from: Math.min(...ranges.map((r) => r.from)),
    to: Math.max(...ranges.map((r) => r.to)),
  };
  const height = (range.to - range.from) * PX_PER_MINUTE;
  const first = days[gutterDayIndex(week)]!;
  return (
    <div className="overflow-x-auto overflow-y-hidden rounded-lg border bg-card">
      <div className="flex min-w-full">
        <div className="sticky start-0 z-10 w-14 shrink-0 border-e bg-card">
          <div className="h-12 border-b" />
          <div className="relative" style={{ height }}>
            {hourMarks(range, first.date, first.timezone).map((mark) => (
              <span
                key={mark.minute}
                dir="ltr"
                className="absolute end-1 -translate-y-1/2 text-xs text-muted-foreground"
                style={{ top: (mark.minute - range.from) * PX_PER_MINUTE }}
              >
                {mark.minute === range.from ? "" : mark.label}
              </span>
            ))}
          </div>
        </div>
        {days.map((day, i) => (
          <ProviderColumn
            key={day.date}
            day={day}
            provider={day.providers[0]!}
            range={range}
            ownClock={!isRegularDay(day.date, day.timezone)}
            title={t("appointments.week.columnTitle", {
              weekday: t(`appointments.weekdays.${WEEKDAY_KEYS[i]!}`),
              day: String(Number(day.date.slice(8))),
            })}
            onBook={(providerId, startsAt) => onBook(i, providerId, startsAt)}
            onReschedule={onReschedule}
            onCancel={onCancel}
          />
        ))}
      </div>
    </div>
  );
}
