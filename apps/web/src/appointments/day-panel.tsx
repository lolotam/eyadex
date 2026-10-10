import { useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import type { Appointment } from "@eyadex/contracts/appointments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorCodeOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { StatusPanel } from "@/shared/shell/status-panel";
import { useAppointmentDay } from "./appointment-queries";
import { BookingDialog, type BookingRequest } from "./booking-dialog";
import { CancelDialog } from "./cancel-dialog";
import { shiftDate } from "./day-grid";
import { DayView } from "./day-view";

type Props = {
  branchId: string;
  date: string;
  today: string;
  ownOnly: boolean;
  onDateChange: (date: string) => void;
};

/** The branch day (slice A2) with its date navigation. */
export function DayPanel({ branchId, date, today, ownOnly, onDateChange }: Props) {
  const { t } = useI18n();
  const day = useAppointmentDay(branchId, date);
  const [booking, setBooking] = useState<BookingRequest | null>(null);
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  return (
    <div>
      <div className="mb-4 flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          aria-label={t("appointments.previousDay")}
          onClick={() => onDateChange(shiftDate(date, -1))}
        >
          <ChevronLeft className="size-4 rtl:rotate-180" />
        </Button>
        <Input
          type="date"
          aria-label={t("appointments.date")}
          className="w-40"
          value={date}
          onChange={(e) => e.target.value && onDateChange(e.target.value)}
        />
        <Button
          variant="outline"
          size="icon"
          aria-label={t("appointments.nextDay")}
          onClick={() => onDateChange(shiftDate(date, 1))}
        >
          <ChevronRight className="size-4 rtl:rotate-180" />
        </Button>
        <Button variant="ghost" onClick={() => onDateChange(today)}>
          {t("appointments.today")}
        </Button>
      </div>
      {day.error ? (
        <StatusPanel
          icon={AlertCircle}
          title={t("appointments.loadError")}
          body={t(`errors.${errorCodeOf(day.error)}`)}
          action={<Button onClick={() => void day.refetch()}>{t("common.tryAgain")}</Button>}
        />
      ) : day.isLoading || !day.data ? (
        <LoadingBlock />
      ) : (
        <>
          <DayView
            day={day.data}
            ownOnly={ownOnly}
            onBook={(providerId, startsAt) => setBooking({ kind: "create", providerId, startsAt })}
            onReschedule={(appointment) => setBooking({ kind: "reschedule", appointment })}
            onCancel={setCancelling}
          />
          <BookingDialog request={booking} day={day.data} onClose={() => setBooking(null)} />
        </>
      )}
      <CancelDialog appointment={cancelling} onClose={() => setCancelling(null)} />
    </div>
  );
}
