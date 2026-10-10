import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorCodeOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { StatusPanel } from "@/shared/shell/status-panel";
import { FilterSelect } from "@/shared/table/filter-select";
import { useAppointmentDay, useAppointmentMonth } from "./appointment-queries";
import { MONTH_KEYS, monthOf, shiftMonth } from "./calendar-dates";
import { MonthView } from "./month-view";
import { PeriodNav } from "./period-nav";

type Props = {
  branchId: string;
  date: string;
  today: string;
  ownOnly: boolean;
  onDateChange: (date: string) => void;
  onOpenDay: (date: string) => void;
};

/** The month (slice A4): counts per day; an optional provider filter above `own`. */
export function MonthPanel({ branchId, date, today, ownOnly, onDateChange, onOpenDay }: Props) {
  const { t } = useI18n();
  const month = monthOf(date);
  const [providerId, setProviderId] = useState<string | null>(null);
  // The filter offers the providers of the branch on the month's first day (as the week's picker).
  const providers = useAppointmentDay(ownOnly ? null : branchId, `${month}-01`);
  const counts = useAppointmentMonth(branchId, month, ownOnly ? null : providerId);
  const go = (m: string) => onDateChange(`${m}-01`);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {!ownOnly && (
          <FilterSelect
            label={t("appointments.provider")}
            value={providerId}
            anyLabel={t("appointments.month.allProviders")}
            options={(providers.data?.providers ?? []).map((p) => ({
              value: p.membershipId,
              label: p.fullName,
            }))}
            onChange={setProviderId}
          />
        )}
        <PeriodNav
          label={t("appointments.month.label", {
            month: t(`appointments.months.${MONTH_KEYS[Number(month.slice(5)) - 1]!}`),
            year: month.slice(0, 4),
          })}
          previousLabel={t("appointments.month.previous")}
          nextLabel={t("appointments.month.next")}
          currentLabel={t("appointments.month.current")}
          onPrevious={() => go(shiftMonth(month, -1))}
          onNext={() => go(shiftMonth(month, 1))}
          onCurrent={() => onDateChange(today)}
        />
      </div>
      {counts.error ? (
        <StatusPanel
          icon={AlertCircle}
          title={t("appointments.loadError")}
          body={t(`errors.${errorCodeOf(counts.error)}`)}
          action={<Button onClick={() => void counts.refetch()}>{t("common.tryAgain")}</Button>}
        />
      ) : counts.isLoading || !counts.data ? (
        <LoadingBlock />
      ) : (
        <MonthView month={counts.data} today={today} onOpenDay={onOpenDay} />
      )}
    </div>
  );
}
