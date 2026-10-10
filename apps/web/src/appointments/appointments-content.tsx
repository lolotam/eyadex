import { useEffect, useState } from "react";
import { AlertCircle, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import type { Appointment } from "@eyadex/contracts/appointments";
import { todayInTimeZone } from "@eyadex/contracts/patients";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorCodeOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useSession } from "@/shared/persona/persona-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { PageHeader } from "@/shared/shell/page-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { FilterSelect } from "@/shared/table/filter-select";
import { useAppointmentBranches, useAppointmentDay } from "./appointment-queries";
import { BookingDialog, type BookingRequest } from "./booking-dialog";
import { CancelDialog } from "./cancel-dialog";
import { shiftDate } from "./day-grid";
import { DayView } from "./day-view";

export function AppointmentsContent() {
  const { t, pick } = useI18n();
  const { session } = useSession();
  const timeZone = session?.clinic?.timezone ?? "Asia/Kuwait";
  const branches = useAppointmentBranches();
  const [branchId, setBranchId] = useState<string | null>(null);
  const [date, setDate] = useState(() => todayInTimeZone(timeZone));
  const [booking, setBooking] = useState<BookingRequest | null>(null);
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  useEffect(() => {
    const listed = branches.data?.items ?? [];
    if (!listed.some((b) => b.id === branchId)) setBranchId(listed[0]?.id ?? null);
  }, [branches.data, branchId]);
  const items = branches.data?.items ?? [];
  const day = useAppointmentDay(branchId, date);

  const failed = branches.error ?? day.error;
  const header = (
    <PageHeader
      title={t("appointments.title")}
      subtitle={`${t("appointments.subtitle")} ${t("appointments.timezoneNote", { zone: timeZone })}`}
    />
  );
  if (failed) {
    return (
      <StatusPanel
        icon={AlertCircle}
        title={t("appointments.loadError")}
        body={t(`errors.${errorCodeOf(failed)}`)}
        action={
          <Button onClick={() => void (branches.error ? branches.refetch() : day.refetch())}>
            {t("common.tryAgain")}
          </Button>
        }
      />
    );
  }
  if (branches.isLoading) return <LoadingBlock />;
  if (items.length === 0) {
    return (
      <div>
        {header}
        <StatusPanel icon={CalendarDays} title={t("appointments.noBranches")} body="" />
      </div>
    );
  }
  return (
    <div>
      {header}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
        <FilterSelect
          label={t("appointments.branch")}
          value={branchId}
          anyLabel={t("appointments.branch")}
          options={items.map((b) => ({ value: b.id, label: pick(b.nameAr, b.nameEn) }))}
          onChange={(value) => value && setBranchId(value)}
        />
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label={t("appointments.previousDay")}
            onClick={() => setDate((d) => shiftDate(d, -1))}
          >
            <ChevronLeft className="size-4 rtl:rotate-180" />
          </Button>
          <Input
            type="date"
            aria-label={t("appointments.date")}
            className="w-40"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
          <Button
            variant="outline"
            size="icon"
            aria-label={t("appointments.nextDay")}
            onClick={() => setDate((d) => shiftDate(d, 1))}
          >
            <ChevronRight className="size-4 rtl:rotate-180" />
          </Button>
          <Button variant="ghost" onClick={() => setDate(todayInTimeZone(timeZone))}>
            {t("appointments.today")}
          </Button>
        </div>
      </div>
      {day.isLoading || !day.data ? (
        <LoadingBlock />
      ) : (
        <DayView
          day={day.data}
          onBook={(providerId, startsAt) => setBooking({ kind: "create", providerId, startsAt })}
          onReschedule={(appointment) => setBooking({ kind: "reschedule", appointment })}
          onCancel={setCancelling}
        />
      )}
      {day.data && (
        <BookingDialog request={booking} day={day.data} onClose={() => setBooking(null)} />
      )}
      <CancelDialog appointment={cancelling} onClose={() => setCancelling(null)} />
    </div>
  );
}
