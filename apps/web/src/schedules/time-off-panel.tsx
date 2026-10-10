import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import type { ProviderSchedule, TimeOff } from "@eyadex/contracts/schedules";
import { Button } from "@/components/ui/button";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { ConfirmActionDialog } from "@/shared/shell/confirm-action-dialog";
import { wallLabel } from "./schedule-forms";
import { useRefreshSchedules } from "./schedule-queries";
import { TimeOffDialog } from "./time-off-dialog";

type Props = { schedule: ProviderSchedule; timeZone: string; mayEdit: boolean };

export function TimeOffPanel({ schedule, timeZone, mayEdit }: Props) {
  const api = useApi();
  const { persona } = usePersona();
  const { t } = useI18n();
  const refresh = useRefreshSchedules();
  const [adding, setAdding] = useState(false);
  const [target, setTarget] = useState<TimeOff | null>(null);
  const membershipId = schedule.provider.membershipId;
  const cancel = useMutation({
    mutationFn: (off: TimeOff) => api.scheduling.cancelTimeOff(persona, membershipId, off.id),
    onSuccess: () => {
      refresh();
      toast.success(t("schedules.timeOffCancelled"));
      setTarget(null);
    },
    onError: (e) => toast.error(t(`errors.${errorCodeOf(e)}`)),
  });
  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{t("schedules.timeOffTitle")}</h2>
        {mayEdit && (
          <Button variant="outline" onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            {t("schedules.addTimeOff")}
          </Button>
        )}
      </div>
      {schedule.timeOff.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("schedules.noTimeOff")}</p>
      )}
      <ul className="flex flex-col gap-2">
        {schedule.timeOff.map((off) => (
          <li
            key={off.id}
            className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm"
          >
            <div>
              <div dir="ltr" className="text-start font-medium">
                {wallLabel(off.startsAt, timeZone)} → {wallLabel(off.endsAt, timeZone)}
              </div>
              {off.note && <div className="text-muted-foreground">{off.note}</div>}
            </div>
            {mayEdit && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("schedules.cancelTimeOff")}
                onClick={() => setTarget(off)}
              >
                <X className="size-4" />
              </Button>
            )}
          </li>
        ))}
      </ul>
      <TimeOffDialog
        membershipId={adding ? membershipId : null}
        timeZone={timeZone}
        onClose={() => setAdding(false)}
      />
      <ConfirmActionDialog
        open={target !== null}
        title={t("schedules.cancelTitle")}
        body={t("schedules.cancelBody")}
        confirmLabel={t("schedules.cancelTimeOff")}
        cancelLabel={t("common.cancel")}
        pending={cancel.isPending}
        onConfirm={() => target && cancel.mutate(target)}
        onClose={() => setTarget(null)}
      />
    </section>
  );
}
