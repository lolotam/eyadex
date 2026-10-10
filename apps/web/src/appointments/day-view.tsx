import { CalendarClock } from "lucide-react";
import type { Appointment, AppointmentDay } from "@eyadex/contracts/appointments";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { StatusPanel } from "@/shared/shell/status-panel";
import { hourMarks, PX_PER_MINUTE, visibleRange } from "./day-grid";
import { ProviderColumn } from "./provider-column";

type Props = {
  day: AppointmentDay;
  /** The caller sees only its own appointments (`view:appointments:own`, A3). */
  ownOnly?: boolean;
  onBook: (providerId: string, startsAt: string) => void;
  onReschedule: (appointment: Appointment) => void;
  onCancel: (appointment: Appointment) => void;
};

/** The branch day (spec §5): an hour axis and one column per provider; scrolls inside itself. */
export function DayView({ day, ownOnly = false, onBook, onReschedule, onCancel }: Props) {
  const { t } = useI18n();
  const noneOfMine = ownOnly && day.appointments.length === 0;
  if (day.providers.length === 0) {
    return (
      <StatusPanel
        icon={CalendarClock}
        title={t(ownOnly ? "appointments.noOwnAppointments" : "appointments.noProviders")}
        body={t(ownOnly ? "appointments.noOwnAppointmentsBody" : "appointments.noProvidersBody")}
      />
    );
  }
  const range = visibleRange(day);
  const height = (range.to - range.from) * PX_PER_MINUTE;
  return (
    <>
      {noneOfMine && (
        <p className="mb-3 text-sm text-muted-foreground">{t("appointments.noOwnAppointments")}</p>
      )}
      <div className="overflow-x-auto overflow-y-hidden rounded-lg border bg-card">
        <div className="flex min-w-full">
          <div className="sticky start-0 z-10 w-14 shrink-0 border-e bg-card">
            <div className="h-12 border-b" />
            <div className="relative" style={{ height }}>
              {hourMarks(range, day.date, day.timezone).map((mark) => (
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
    </>
  );
}
