import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CalendarClock } from "lucide-react";
import type { Appointment } from "@eyadex/contracts/appointments";
import { Button } from "@/components/ui/button";
import { errorCodeOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { StatusPanel } from "@/shared/shell/status-panel";
import { FilterSelect } from "@/shared/table/filter-select";
import { useAppointmentDay, useAppointmentWeek } from "./appointment-queries";
import { BookingDialog, type BookingRequest } from "./booking-dialog";
import { keptProvider, weekDayIndexOf, weekDialogDay, weekStartOf } from "./calendar-dates";
import { CancelDialog } from "./cancel-dialog";
import { shiftDate } from "./day-grid";
import { PeriodNav } from "./period-nav";
import { WeekView } from "./week-view";

type Props = {
  branchId: string;
  date: string;
  today: string;
  ownOnly: boolean;
  onDateChange: (date: string) => void;
};

/** The provider week (slice A4): picker of the branch's providers; under `own` only the caller. */
export function WeekPanel({ branchId, date, today, ownOnly, onDateChange }: Props) {
  const { t, formatDate } = useI18n();
  const weekStart = weekStartOf(date);
  const providers = useAppointmentDay(branchId, weekStart);
  const listed = useMemo(() => providers.data?.providers ?? [], [providers.data]);
  const [providerId, setProviderId] = useState<string | null>(null);
  useEffect(() => {
    const kept = keptProvider(providerId, providers.data?.providers);
    if (kept !== providerId) setProviderId(kept);
  }, [providers.data, providerId]);
  const week = useAppointmentWeek(branchId, providerId, weekStart);
  const [booking, setBooking] = useState<{ request: BookingRequest; dayIndex: number } | null>(
    null,
  );
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  const failed = providers.error ?? week.error;

  const nav = (
    <PeriodNav
      // Local noon, not UTC: the label is a calendar date and must not move with the browser's offset.
      label={t("appointments.week.of", { date: formatDate(`${weekStart}T12:00:00`) })}
      previousLabel={t("appointments.week.previous")}
      nextLabel={t("appointments.week.next")}
      currentLabel={t("appointments.week.current")}
      onPrevious={() => onDateChange(shiftDate(weekStart, -7))}
      onNext={() => onDateChange(shiftDate(weekStart, 7))}
      onCurrent={() => onDateChange(today)}
    />
  );
  let body;
  if (failed) {
    body = (
      <StatusPanel
        icon={AlertCircle}
        title={t("appointments.loadError")}
        body={t(`errors.${errorCodeOf(failed)}`)}
        action={
          <Button onClick={() => void (providers.error ? providers.refetch() : week.refetch())}>
            {t("common.tryAgain")}
          </Button>
        }
      />
    );
  } else if (providers.isLoading) {
    body = <LoadingBlock />;
  } else if (listed.length === 0) {
    body = (
      <StatusPanel
        icon={CalendarClock}
        title={t(ownOnly ? "appointments.noOwnAppointments" : "appointments.noProviders")}
        body={t(ownOnly ? "appointments.noOwnAppointmentsBody" : "appointments.noProvidersBody")}
      />
    );
  } else if (week.isLoading || !week.data) {
    body = <LoadingBlock />;
  } else {
    const data = week.data;
    body = (
      <>
        <WeekView
          week={data}
          onBook={(dayIndex, id, startsAt) =>
            setBooking({ request: { kind: "create", providerId: id, startsAt }, dayIndex })
          }
          onReschedule={(appointment) =>
            setBooking({
              request: { kind: "reschedule", appointment },
              dayIndex: weekDayIndexOf(data, appointment.startsAt),
            })
          }
          onCancel={setCancelling}
        />
        <BookingDialog
          request={booking?.request ?? null}
          day={weekDialogDay(data, booking?.dayIndex ?? 0, listed)}
          onClose={() => setBooking(null)}
        />
      </>
    );
  }
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {!ownOnly && listed.length > 0 && (
          <FilterSelect
            label={t("appointments.provider")}
            value={providerId}
            options={listed.map((p) => ({ value: p.membershipId, label: p.fullName }))}
            onChange={(value) => value && setProviderId(value)}
          />
        )}
        {nav}
      </div>
      {body}
      <CancelDialog appointment={cancelling} onClose={() => setCancelling(null)} />
    </div>
  );
}
