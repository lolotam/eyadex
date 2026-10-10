import { AlertTriangle } from "lucide-react";
import type { Appointment } from "@eyadex/contracts/appointments";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { AppointmentActions } from "./appointment-actions";
import { STATUS_LOOK } from "./appointment-status-look";
import { wallTime } from "./day-grid";

type Props = {
  appointment: Appointment;
  timeZone: string;
  box: { top: number; height: number };
  lane: { lane: number; of: number };
  canUpdate: boolean;
  onReschedule: (appointment: Appointment) => void;
  onCancel: (appointment: Appointment) => void;
};

/** One appointment on the day: patient, time, status (icon + label + tint), its actions. */
export function AppointmentBlock({
  appointment: a,
  timeZone,
  box,
  lane,
  canUpdate,
  onReschedule,
  onCancel,
}: Props) {
  const { t } = useI18n();
  const look = STATUS_LOOK[a.status];
  const width = 100 / lane.of;
  return (
    <div
      className={`absolute z-[1] overflow-hidden rounded-md border px-2 py-1 text-xs shadow-sm ${look.tint}`}
      style={{
        top: box.top + 1,
        height: Math.max(box.height - 2, 18),
        insetInlineStart: `${lane.lane * width}%`,
        width: `calc(${width}% - 4px)`,
      }}
    >
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{a.patientName}</p>
          <p className="truncate text-[11px] text-muted-foreground" dir="ltr">
            {wallTime(a.startsAt, timeZone)}–{wallTime(a.endsAt, timeZone)}
          </p>
        </div>
        {canUpdate && (
          <AppointmentActions appointment={a} onReschedule={onReschedule} onCancel={onCancel} />
        )}
      </div>
      <p className="mt-0.5 flex items-center gap-1 truncate text-[11px]">
        <look.icon className="size-3 shrink-0" aria-hidden />
        {t(`appointments.status.${a.status}`)}
        {a.overbooked && (
          <span className="ms-1 inline-flex items-center gap-0.5 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-3" aria-hidden />
            {t("appointments.overbooked")}
          </span>
        )}
      </p>
    </div>
  );
}
