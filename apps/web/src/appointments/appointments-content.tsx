import { useEffect, useState } from "react";
import { AlertCircle, CalendarDays } from "lucide-react";
import { todayInTimeZone } from "@eyadex/contracts/patients";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorCodeOf } from "@/shared/api/api-error";
import { can } from "@/shared/permissions/can";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useSession } from "@/shared/persona/persona-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { PageHeader } from "@/shared/shell/page-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { FilterSelect } from "@/shared/table/filter-select";
import { useAppointmentBranches } from "./appointment-queries";
import { APPOINTMENT_VIEWS, parseAppointmentView, useAppointmentView } from "./appointment-view";
import { DayPanel } from "./day-panel";
import { MonthPanel } from "./month-panel";
import { QueuePanel } from "./queue-panel";
import { WeekPanel } from "./week-panel";

export function AppointmentsContent() {
  const { t, pick } = useI18n();
  const { session } = useSession();
  const timeZone = session?.clinic?.timezone ?? "Asia/Kuwait";
  const branches = useAppointmentBranches();
  const [view, setView] = useAppointmentView();
  const [branchId, setBranchId] = useState<string | null>(null);
  const [date, setDate] = useState(() => todayInTimeZone(timeZone));
  const today = todayInTimeZone(timeZone);
  useEffect(() => {
    const listed = branches.data?.items ?? [];
    if (!listed.some((b) => b.id === branchId)) setBranchId(listed[0]?.id ?? null);
  }, [branches.data, branchId]);
  const items = branches.data?.items ?? [];
  // A3: with only the own key every view shows the caller alone; the week has no provider picker.
  const ownOnly = !can(session?.permissions ?? [], "view", "appointments", ["clinic", "branch"]);

  const header = (
    <PageHeader
      title={t("appointments.title")}
      subtitle={`${t("appointments.subtitle")} ${t("appointments.timezoneNote", { zone: timeZone })}`}
    />
  );
  if (branches.error) {
    return (
      <StatusPanel
        icon={AlertCircle}
        title={t("appointments.loadError")}
        body={t(`errors.${errorCodeOf(branches.error)}`)}
        action={<Button onClick={() => void branches.refetch()}>{t("common.tryAgain")}</Button>}
      />
    );
  }
  if (branches.isLoading) return <LoadingBlock />;
  if (items.length === 0 || branchId === null) {
    return (
      <div>
        {header}
        <StatusPanel icon={CalendarDays} title={t("appointments.noBranches")} body="" />
      </div>
    );
  }
  const shared = { branchId, date, today, ownOnly, onDateChange: setDate };
  return (
    <div>
      {header}
      <Tabs value={view} onValueChange={(v) => setView(parseAppointmentView(v))}>
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
          <FilterSelect
            label={t("appointments.branch")}
            value={branchId}
            anyLabel={t("appointments.branch")}
            options={items.map((b) => ({ value: b.id, label: pick(b.nameAr, b.nameEn) }))}
            onChange={(value) => value && setBranchId(value)}
          />
          <TabsList className="max-w-full overflow-x-auto">
            {APPOINTMENT_VIEWS.map((v) => (
              <TabsTrigger key={v} value={v} className="px-3">
                {t(`appointments.views.${v}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="day">
          <DayPanel {...shared} />
        </TabsContent>
        <TabsContent value="week">
          <WeekPanel {...shared} />
        </TabsContent>
        <TabsContent value="month">
          <MonthPanel
            {...shared}
            onOpenDay={(d) => {
              setDate(d);
              setView("day");
            }}
          />
        </TabsContent>
        <TabsContent value="queue">
          <QueuePanel branchId={branchId} today={today} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
