import { useEffect, useState } from "react";
import { AlertCircle, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorCodeOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { can } from "@/shared/permissions/can";
import { useSession } from "@/shared/persona/persona-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { SectionHeader } from "@/shared/shell/section-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { FilterSelect } from "@/shared/table/filter-select";
import { DormantHoursPanel } from "./dormant-hours-panel";
import { useProviderSchedule, useProviders } from "./schedule-queries";
import { TimeOffPanel } from "./time-off-panel";
import { WeeklyScheduleEditor } from "./weekly-schedule-editor";

export function SchedulesContent() {
  const { t, pick } = useI18n();
  const { session } = useSession();
  const permissions = session?.permissions ?? [];
  const timeZone = session?.clinic?.timezone ?? "Asia/Kuwait";
  const providers = useProviders();
  const [membershipId, setMembershipId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const list = providers.data ?? [];
  // Only a listed provider is read: one seen only through left rows drops out once they are cleared.
  const selected = list.some((p) => p.membershipId === membershipId)
    ? membershipId
    : (list[0]?.membershipId ?? null);
  const schedule = useProviderSchedule(selected);
  useEffect(() => {
    const branches = schedule.data?.branches ?? [];
    if (!branches.some((b) => b.id === branchId)) setBranchId(branches[0]?.id ?? null);
  }, [schedule.data, branchId]);

  const failed = providers.error ?? schedule.error;
  if (failed) {
    return (
      <StatusPanel
        icon={AlertCircle}
        title={t("schedules.loadError")}
        body={t(`errors.${errorCodeOf(failed)}`)}
        action={
          <Button onClick={() => void (providers.error ? providers.refetch() : schedule.refetch())}>
            {t("common.tryAgain")}
          </Button>
        }
      />
    );
  }
  const header = (
    <SectionHeader
      title={t("schedules.title")}
      subtitle={t("schedules.subtitle", { zone: timeZone })}
    />
  );
  if (providers.isLoading) return <LoadingBlock />;
  if (list.length === 0) {
    return (
      <div>
        {header}
        <StatusPanel
          icon={CalendarClock}
          title={t("schedules.noProviders")}
          body={t("schedules.noProvidersBody")}
        />
      </div>
    );
  }
  return (
    <div>
      {header}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
        <FilterSelect
          label={t("schedules.provider")}
          value={selected}
          anyLabel={t("schedules.pickProvider")}
          options={list.map((p) => ({
            value: p.membershipId,
            label: p.fullName,
          }))}
          onChange={setMembershipId}
        />
        <FilterSelect
          label={t("schedules.branch")}
          value={branchId}
          anyLabel={t("schedules.branch")}
          options={(schedule.data?.branches ?? []).map((b) => ({
            value: b.id,
            label: pick(b.nameAr, b.nameEn),
          }))}
          onChange={setBranchId}
        />
      </div>
      {schedule.isLoading && <LoadingBlock />}
      {schedule.data && (
        <div className="grid gap-4 lg:grid-cols-2">
          {branchId && (
            <WeeklyScheduleEditor
              schedule={schedule.data}
              branchId={branchId}
              mayEdit={can(permissions, "update", "schedules")}
            />
          )}
          <TimeOffPanel
            schedule={schedule.data}
            timeZone={timeZone}
            mayEdit={permissions.includes("update:schedules:clinic")}
          />
        </div>
      )}
      {schedule.data && (
        <DormantHoursPanel
          schedule={schedule.data}
          mayEdit={can(permissions, "update", "schedules")}
        />
      )}
    </div>
  );
}
