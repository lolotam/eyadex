import { CalendarCheck, AlertTriangle } from "lucide-react";
import type { Appointment, AppointmentDay } from "@eyadex/contracts/appointments";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { StatusPanel } from "@/shared/shell/status-panel";
import { StartVisitButton } from "./start-visit-button";
import { AppointmentActions } from "./appointment-actions";
import { STATUS_LOOK } from "./appointment-status-look";
import { wallTime } from "./day-grid";

type Props = { day: AppointmentDay; onCancel: (appointment: Appointment) => void };

/**
 * Today's queue: the branch day as one list by start time. The menu offers only the moves of
 * APPOINTMENT_TRANSITIONS and cancel (no reschedule here); it shows only with `can.update`.
 */
export function QueueView({ day, onCancel }: Props) {
  const { t, pick } = useI18n();
  const rows = [...day.appointments].sort(
    (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id),
  );
  if (rows.length === 0) {
    return (
      <StatusPanel
        icon={CalendarCheck}
        title={t("appointments.queue.empty")}
        body={t("appointments.queue.emptyBody")}
      />
    );
  }
  return (
    <ul className="divide-y rounded-lg border bg-card" aria-label={t("appointments.queue.title")}>
      {rows.map((a) => {
        const look = STATUS_LOOK[a.status];
        const service =
          a.serviceNameAr !== null && a.serviceNameEn !== null
            ? pick(a.serviceNameAr, a.serviceNameEn)
            : t("appointments.queue.noService");
        return (
          <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm">
            <span dir="ltr" className="w-24 shrink-0 font-medium tabular-nums">
              {wallTime(a.startsAt, day.timezone)}–{wallTime(a.endsAt, day.timezone)}
            </span>
            <div className="min-w-40 flex-1">
              <p className="font-medium">{a.patientName}</p>
              <p className="text-xs text-muted-foreground">
                {t("appointments.queue.fileNumber", { fileNumber: String(a.patientFileNumber) })}
              </p>
            </div>
            <div className="min-w-32 flex-1 text-muted-foreground">
              <p>{a.providerName}</p>
              <p className="text-xs">{service}</p>
            </div>
            <span
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${look.tint}`}
            >
              <look.icon className="size-3.5" aria-hidden />
              {t(`appointments.status.${a.status}`)}
            </span>
            {a.overbooked && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="size-3" aria-hidden />
                {t("appointments.overbooked")}
              </span>
            )}
            <StartVisitButton appointment={a} />
            <div className="ms-auto w-6">
              {day.can.update && <AppointmentActions appointment={a} onCancel={onCancel} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
