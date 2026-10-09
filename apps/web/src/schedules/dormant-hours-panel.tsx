import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ProviderSchedule, ScheduleBranch } from "@eyadex/contracts/schedules";
import { Button } from "@/components/ui/button";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { ConfirmActionDialog } from "@/shared/shell/confirm-action-dialog";
import { WEEKDAY_KEYS, rowsForBranch } from "./schedule-forms";
import { useRefreshSchedules } from "./schedule-queries";

type Props = { schedule: ProviderSchedule; mayEdit: boolean };

/**
 * Hours kept in an inactive branch or one the provider left (ADR-0026 §4). They still block
 * overlapping hours elsewhere, so they are shown read-only and can only be cleared (an empty week).
 */
export function DormantHoursPanel({ schedule, mayEdit }: Props) {
  const api = useApi();
  const { persona } = usePersona();
  const { t, pick } = useI18n();
  const refresh = useRefreshSchedules();
  const [target, setTarget] = useState<ScheduleBranch | null>(null);
  const clear = useMutation({
    mutationFn: (branch: ScheduleBranch) =>
      api.scheduling.replaceBranchSchedule(persona, schedule.provider.membershipId, branch.id, {
        shifts: [],
      }),
    onSuccess: () => {
      refresh();
      toast.success(t("schedules.dormant.cleared"));
      setTarget(null);
    },
    onError: (e) => toast.error(t(`errors.${errorCodeOf(e)}`)),
  });
  if (schedule.dormantBranches.length === 0) return null;
  return (
    <section className="mt-4 flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div>
        <h2 className="font-semibold">{t("schedules.dormant.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("schedules.dormant.hint")}</p>
      </div>
      <ul className="flex flex-col gap-2">
        {schedule.dormantBranches.map((branch) => (
          <li
            key={branch.id}
            className="flex flex-wrap items-start justify-between gap-2 rounded-md border p-3"
          >
            <div className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{pick(branch.nameAr, branch.nameEn)}</span>
              <span className="text-muted-foreground">
                {t(branch.isActive ? "schedules.dormant.left" : "schedules.dormant.inactive")}
              </span>
              <ul className="flex flex-col">
                {rowsForBranch(schedule, branch.id).map((row) => (
                  <li key={row.key}>
                    {t(`schedules.weekdays.${WEEKDAY_KEYS[row.weekday] ?? "sun"}`)}{" "}
                    <span dir="ltr">
                      {row.startsAt}–{row.endsAt}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            {mayEdit && (
              <Button variant="outline" size="sm" onClick={() => setTarget(branch)}>
                <Trash2 className="size-4" />
                {t("schedules.dormant.clear")}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <ConfirmActionDialog
        open={target !== null}
        title={t("schedules.dormant.clearTitle")}
        body={t("schedules.dormant.clearBody")}
        confirmLabel={t("schedules.dormant.clear")}
        cancelLabel={t("common.cancel")}
        pending={clear.isPending}
        onConfirm={() => target && clear.mutate(target)}
        onClose={() => setTarget(null)}
      />
    </section>
  );
}
