import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  appointmentCancelSchema,
  CANCEL_REASONS,
  type Appointment,
  type AppointmentCancelInput,
} from "@eyadex/contracts/appointments";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { SelectField, TextField } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { useRefreshAppointments } from "./appointment-queries";

const EMPTY: AppointmentCancelInput = { reason: "patient_cancelled", note: "" };

type Props = { appointment: Appointment | null; onClose: () => void };

/** D-11: a reason from the short list and an optional note (never written to the audit log). */
export function CancelDialog({ appointment, onClose }: Props) {
  const api = useApi();
  const { persona } = usePersona();
  const { t } = useI18n();
  const refresh = useRefreshAppointments();
  const form = useForm<AppointmentCancelInput>({
    resolver: zodResolver(appointmentCancelSchema),
    defaultValues: EMPTY,
  });
  useEffect(() => form.reset(EMPTY), [appointment, form]);
  const mutation = useMutation({
    mutationFn: (values: AppointmentCancelInput) =>
      api.appointments.cancel(persona, appointment?.id ?? "", {
        reason: values.reason,
        note: values.note === "" ? null : values.note,
      }),
    onSuccess: () => {
      refresh();
      toast.success(t("appointments.cancelDialog.done"));
      onClose();
    },
    onError: (e) => toast.error(t(`errors.${errorCodeOf(e)}`)),
  });
  return (
    <Dialog open={appointment !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>{t("appointments.cancelDialog.title")}</DialogTitle>
          <DialogDescription>{appointment?.patientName}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id="cancel-appointment-form"
            className="grid gap-4"
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          >
            <SelectField
              control={form.control}
              name="reason"
              label={t("appointments.cancelDialog.reason")}
              options={CANCEL_REASONS.map((r) => ({
                value: r,
                label: t(`appointments.reasons.${r}`),
              }))}
            />
            <TextField
              control={form.control}
              name="note"
              label={t("appointments.cancelDialog.note")}
            />
          </form>
        </Form>
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("appointments.cancelDialog.keep")}
          </Button>
          <Button
            type="submit"
            form="cancel-appointment-form"
            variant="destructive"
            disabled={mutation.isPending}
          >
            {t("appointments.cancelDialog.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
