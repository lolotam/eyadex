import { CalendarClock } from "lucide-react";
import type { Appointment, AppointmentDay } from "@eyadex/contracts/appointments";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { StatusPanel } from "@/shared/shell/status-panel";
import { hourMarks, PX_PER_MINUTE, visibleRange } from "./day-grid";
import { ProviderColumn } from "./provider-column";

type Props = {
  day: AppointmentDay;
  onBook: (providerId: string, startTime: string) => void;
  onReschedule: (appointment: Appointment) => void;
  onCancel: (appointment: Appointment) => void;
};

/** The branch day (spec §5): an hour axis and one column per provider; scrolls inside itself. */
export function DayView({ day, onBook, onReschedule, onCancel }: Props) {
  const { t } = useI18n();
  if (day.providers.length === 0) {
    return (
      <StatusPanel
        icon={CalendarClock}
        title={t("appointments.noProviders")}
        body={t("appointments.noProvidersBody")}
      />
    );
  }
  const range = visibleRange(day);
  const height = (range.to - range.from) * PX_PER_MINUTE;
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <div className="flex min-w-max">
        <div className="sticky start-0 z-10 w-14 shrink-0 border-e bg-card">
          <div className="h-12 border-b" />
          <div className="relative" style={{ height }}>
            {hourMarks(range).map((mark) => (
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
        {day.providers.map((provider) => (
          <ProviderColumn
            key={provider.membershipId}
            day={day}
            provider={provider}
            range={range}
            onBook={onBook}
            onReschedule={onReschedule}
            onCancel={onCancel}
          />
        ))}
      </div>
    </div>
  );
}
