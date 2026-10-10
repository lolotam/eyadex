import type { Appointment, AppointmentDay, DayProvider } from "@eyadex/contracts/appointments";
import { Badge } from "@/components/ui/badge";
import { wallMinutes, minutesToWall } from "@eyadex/contracts/schedules";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { AppointmentBlock } from "./appointment-block";
import { lanes, minuteOfDay, placement, PX_PER_MINUTE, SLOT_MINUTES, slotStarts } from "./day-grid";

type Props = {
  day: AppointmentDay;
  provider: DayProvider;
  range: { from: number; to: number };
  onBook: (providerId: string, startTime: string) => void;
  onReschedule: (appointment: Appointment) => void;
  onCancel: (appointment: Appointment) => void;
};

/** One provider's column: working hours shaded, time off hatched, a slot button per half hour. */
export function ProviderColumn({ day, provider, range, onBook, onReschedule, onCancel }: Props) {
  const { t } = useI18n();
  const height = (range.to - range.from) * PX_PER_MINUTE;
  const at = (iso: string) => minuteOfDay(iso, day.date, day.timezone);
  const mayBook = day.can.create && provider.bookable;
  const mine = day.appointments.filter((a) => a.providerMembershipId === provider.membershipId);
  const placed = lanes(mine);
  return (
    <div className="w-44 shrink-0 border-e last:border-e-0 sm:w-52">
      <div className="flex h-12 items-center gap-2 border-b px-3">
        <span className="truncate text-sm font-medium" title={provider.fullName}>
          {provider.fullName}
        </span>
        {!provider.bookable && (
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            {t("appointments.notBookable")}
          </Badge>
        )}
      </div>
      <div className="relative bg-muted/40" style={{ height }}>
        {provider.shifts.map((s) => {
          const box = placement(wallMinutes(s.startsAt), wallMinutes(s.endsAt), range);
          return (
            box && (
              <div
                key={`${s.startsAt}-${s.endsAt}`}
                className="absolute inset-x-0 bg-background"
                style={box}
                aria-hidden
              />
            )
          );
        })}
        {provider.timeOff.map((o) => {
          const box = placement(at(o.startsAt), at(o.endsAt), range);
          return (
            box && (
              <div
                key={o.startsAt}
                className="absolute inset-x-0 bg-[repeating-linear-gradient(135deg,var(--muted)_0_6px,transparent_6px_12px)] text-center text-[10px] text-muted-foreground"
                style={box}
              >
                {t("appointments.timeOff")}
              </div>
            )
          );
        })}
        {slotStarts(range).map((minute) => (
          <div
            key={minute}
            className="absolute inset-x-0 border-t border-dashed border-border/60"
            style={{
              top: (minute - range.from) * PX_PER_MINUTE,
              height: SLOT_MINUTES * PX_PER_MINUTE,
            }}
          >
            {mayBook && (
              <button
                type="button"
                className="size-full hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-none"
                aria-label={t("appointments.bookAt", {
                  provider: provider.fullName,
                  time: minutesToWall(minute),
                })}
                onClick={() => onBook(provider.membershipId, minutesToWall(minute))}
              />
            )}
          </div>
        ))}
        {mine.map((a) => {
          const box = placement(at(a.startsAt), at(a.endsAt), range);
          return (
            box && (
              <AppointmentBlock
                key={a.id}
                appointment={a}
                timeZone={day.timezone}
                box={box}
                lane={placed.get(a.id) ?? { lane: 0, of: 1 }}
                canUpdate={day.can.update}
                onReschedule={onReschedule}
                onCancel={onCancel}
              />
            )
          );
        })}
      </div>
    </div>
  );
}
