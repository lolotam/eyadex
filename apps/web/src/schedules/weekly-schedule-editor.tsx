import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { branchScheduleInputSchema, type ProviderSchedule } from "@eyadex/contracts/schedules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { WEEKDAY_KEYS, rowsForBranch, toWeekInput, type WeekRow } from "./schedule-forms";
import { useRefreshSchedules } from "./schedule-queries";

type Props = { schedule: ProviderSchedule; branchId: string; mayEdit: boolean };

export function WeeklyScheduleEditor({ schedule, branchId, mayEdit }: Props) {
  const api = useApi();
  const { persona } = usePersona();
  const { t, tDynamic } = useI18n();
  const refresh = useRefreshSchedules();
  const [rows, setRows] = useState<WeekRow[]>(() => rowsForBranch(schedule, branchId));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setRows(rowsForBranch(schedule, branchId));
    setError(null);
  }, [schedule, branchId]);

  const mutation = useMutation({
    mutationFn: () =>
      api.scheduling.replaceBranchSchedule(
        persona,
        schedule.provider.membershipId,
        branchId,
        toWeekInput(rows),
      ),
    onSuccess: () => {
      refresh();
      toast.success(t("schedules.saved"));
    },
    onError: (e) => setError(t(`errors.${errorCodeOf(e)}`)),
  });

  const edit = (key: string, patch: Partial<WeekRow>) =>
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const save = () => {
    const parsed = branchScheduleInputSchema.safeParse(toWeekInput(rows));
    if (!parsed.success) {
      setError(tDynamic(parsed.error.issues[0]?.message ?? "errors.validation"));
      return;
    }
    setError(null);
    mutation.mutate();
  };

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div>
        <h2 className="font-semibold">{t("schedules.weekTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("schedules.weekHint")}</p>
      </div>
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("schedules.noShifts")}</p>
      )}
      {rows.map((row) => (
        <div key={row.key} className="grid grid-cols-[1fr_auto_auto_auto] items-end gap-2">
          <Select
            value={String(row.weekday)}
            disabled={!mayEdit}
            onValueChange={(v) => edit(row.key, { weekday: Number(v) })}
          >
            <SelectTrigger aria-label={t("schedules.weekday")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEKDAY_KEYS.map((day, index) => (
                <SelectItem key={day} value={String(index)}>
                  {t(`schedules.weekdays.${day}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="w-24"
            dir="ltr"
            inputMode="numeric"
            placeholder="09:00"
            aria-label={t("schedules.startsAt")}
            disabled={!mayEdit}
            value={row.startsAt}
            onChange={(e) => edit(row.key, { startsAt: e.target.value })}
          />
          <Input
            className="w-24"
            dir="ltr"
            inputMode="numeric"
            placeholder="13:00"
            aria-label={t("schedules.endsAt")}
            disabled={!mayEdit}
            value={row.endsAt}
            onChange={(e) => edit(row.key, { endsAt: e.target.value })}
          />
          {mayEdit && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("schedules.removeShift")}
              onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      ))}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {mayEdit && (
        <div className="flex flex-wrap justify-between gap-2">
          <Button
            variant="outline"
            onClick={() =>
              setRows((current) => [
                ...current,
                { key: crypto.randomUUID(), weekday: 0, startsAt: "09:00", endsAt: "13:00" },
              ])
            }
          >
            <Plus className="size-4" />
            {t("schedules.addShift")}
          </Button>
          <Button onClick={save} disabled={mutation.isPending}>
            {t("schedules.saveWeek")}
          </Button>
        </div>
      )}
    </section>
  );
}
