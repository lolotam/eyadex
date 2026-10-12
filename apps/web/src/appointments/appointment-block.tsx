import { AlertTriangle } from "lucide-react";
import type { Appointment } from "@eyadex/contracts/appointments";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { StartVisitButton } from "./start-visit-button";
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
      className={`absolute z-[1] overflow-hidden rounded-md border px-1.5 py-0.5 text-xs leading-tight shadow-sm ${look.tint}`}
      style={{
        top: box.top + 1,
        height: Math.max(box.height - 2, 18),
        insetInlineStart: `${lane.lane * width}%`,
        width: `calc(${width}% - 4px)`,
      }}
      title={`${a.patientName} · ${t(`appointments.status.${a.status}`)}`}
    >
      <div className="flex items-center gap-1">
        <look.icon className="size-3 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1 truncate font-medium">{a.patientName}</p>
        <AppointmentActions
          appointment={a}
          canUpdate={canUpdate}
          onReschedule={onReschedule}
          onCancel={onCancel}
        />
      </div>
      <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
        <span dir="ltr">
          {wallTime(a.startsAt, timeZone)}–{wallTime(a.endsAt, timeZone)}
        </span>
        <span>· {t(`appointments.status.${a.status}`)}</span>
        {a.overbooked && (
          <span className="inline-flex items-center gap-0.5 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-3" aria-hidden />
            {t("appointments.overbooked")}
          </span>
        )}
      </p>
      <StartVisitButton appointment={a} compact />
    </div>
  );
}
