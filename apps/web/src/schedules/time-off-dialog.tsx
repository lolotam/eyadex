import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { TextField } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { timeOffFormSchema, toTimeOffInput, type TimeOffForm } from "./schedule-forms";
import { useRefreshSchedules } from "./schedule-queries";

const EMPTY: TimeOffForm = {
  startDate: "",
  startTime: "08:00",
  endDate: "",
  endTime: "20:00",
  note: "",
};

type Props = { membershipId: string | null; timeZone: string; onClose: () => void };

export function TimeOffDialog({ membershipId, timeZone, onClose }: Props) {
  const api = useApi();
  const { persona } = usePersona();
  const { t } = useI18n();
  const refresh = useRefreshSchedules();
  const form = useForm<TimeOffForm>({
    resolver: zodResolver(timeOffFormSchema),
    defaultValues: EMPTY,
  });
  useEffect(() => form.reset(EMPTY), [membershipId, form]);
  const mutation = useMutation({
    mutationFn: (values: TimeOffForm) =>
      api.scheduling.addTimeOff(persona, membershipId ?? "", toTimeOffInput(values, timeZone)),
    onSuccess: () => {
      refresh();
      toast.success(t("schedules.timeOffAdded"));
      onClose();
    },
    onError: (e) => toast.error(t(`errors.${errorCodeOf(e)}`)),
  });
  return (
    <Dialog open={membershipId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>{t("schedules.addTimeOff")}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            id="time-off-form"
            className="grid grid-cols-2 gap-4"
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          >
            <TextField
              control={form.control}
              name="startDate"
              type="date"
              label={t("schedules.fields.startDate")}
            />
            <TextField
              control={form.control}
              name="startTime"
              dir="ltr"
              label={t("schedules.fields.startTime")}
            />
            <TextField
              control={form.control}
              name="endDate"
              type="date"
              label={t("schedules.fields.endDate")}
            />
            <TextField
              control={form.control}
              name="endTime"
              dir="ltr"
              label={t("schedules.fields.endTime")}
            />
            <div className="col-span-2">
              <TextField control={form.control} name="note" label={t("schedules.fields.note")} />
            </div>
          </form>
        </Form>
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="time-off-form" disabled={mutation.isPending}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
