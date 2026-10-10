import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Appointment, AppointmentDay } from "@eyadex/contracts/appointments";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { SelectField, SwitchField, TextField } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { can } from "@/shared/permissions/can";
import { usePersona, useSession } from "@/shared/persona/persona-provider";
import { useBookingServices, useRefreshAppointments } from "./appointment-queries";
import {
  bookingFormSchema,
  endFor,
  formOf,
  NO_SERVICE,
  slotRefusal,
  toAppointmentInput,
  toRescheduleInput,
  type BookingForm,
} from "./booking-form";
import { PatientPicker, type PickedPatient } from "./patient-picker";

export type BookingRequest =
  | { kind: "create"; providerId: string; date: string; startTime: string }
  | { kind: "reschedule"; appointment: Appointment };

type Props = { request: BookingRequest | null; day: AppointmentDay; onClose: () => void };

function initial(request: BookingRequest, day: AppointmentDay): BookingForm {
  if (request.kind === "reschedule") return formOf(request.appointment, day.timezone);
  const provider = day.providers.find((p) => p.membershipId === request.providerId);
  return {
    patientId: "",
    providerMembershipId: request.providerId,
    serviceId: NO_SERVICE,
    date: request.date,
    startTime: request.startTime,
    endTime: endFor(request.startTime, provider?.defaultDurationMinutes ?? 20),
    overbook: false,
  };
}

/** The booking dialog (spec §5): create or move; rule 2's refusals are explained by the time. */
export function BookingDialog({ request, day, onClose }: Props) {
  const api = useApi();
  const { persona } = usePersona();
  const { session } = useSession();
  const { t, pick } = useI18n();
  const refresh = useRefreshAppointments();
  const services = useBookingServices(can(session?.permissions ?? [], "view", "services"));
  const key = useRef(crypto.randomUUID());
  const [patient, setPatient] = useState<PickedPatient | null>(null);
  const creating = request?.kind === "create";
  const form = useForm<BookingForm>({ resolver: zodResolver(bookingFormSchema) });
  useEffect(() => {
    if (request === null) return;
    key.current = crypto.randomUUID();
    setPatient(null);
    form.reset(initial(request, day));
  }, [request, day, form]);
  const [providerId, serviceId, startTime] = useWatch({
    control: form.control,
    name: ["providerMembershipId", "serviceId", "startTime"],
  });
  // Rule 4's pre-fill: the service's length, else the provider's default (the end stays editable).
  useEffect(() => {
    if (!creating || !form.formState.isDirty) return;
    const service = services.data?.find((s) => s.id === serviceId);
    const provider = day.providers.find((p) => p.membershipId === providerId);
    const minutes = service?.durationMinutes ?? provider?.defaultDurationMinutes ?? 20;
    if (/^\d{2}:\d{2}$/.test(startTime ?? "")) form.setValue("endTime", endFor(startTime, minutes));
  }, [creating, providerId, serviceId, startTime, services.data, day.providers, form]);

  const mutation = useMutation({
    mutationFn: (values: BookingForm) =>
      request?.kind === "reschedule"
        ? api.appointments.reschedule(
            persona,
            request.appointment.id,
            toRescheduleInput(values, day.branch.id, day.timezone),
          )
        : api.appointments.create(
            persona,
            toAppointmentInput(values, day.branch.id, day.timezone),
            key.current,
          ),
    onSuccess: () => {
      refresh();
      toast.success(t(creating ? "appointments.dialog.booked" : "appointments.dialog.moved"));
      onClose();
    },
    onError: (e) => {
      const refusal = slotRefusal(e);
      if (refusal) form.setError("startTime", { message: `errors.${refusal}` });
      else toast.error(t(`errors.${errorCodeOf(e)}`));
    },
  });
  const providers = day.providers.filter((p) => p.bookable);
  const serviceOptions = [
    { value: NO_SERVICE, label: t("appointments.dialog.noService") },
    ...(services.data ?? []).map((s) => ({ value: s.id, label: pick(s.nameAr, s.nameEn) })),
  ];
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="text-start">
          <DialogTitle>
            {t(
              creating ? "appointments.dialog.createTitle" : "appointments.dialog.rescheduleTitle",
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-2">
          <Label>{t("appointments.dialog.patient")}</Label>
          {request?.kind === "reschedule" ? (
            <p className="rounded-lg border px-3 py-2 text-sm">{request.appointment.patientName}</p>
          ) : (
            <PatientPicker
              value={patient}
              branchId={day.branch.id}
              error={form.formState.errors.patientId?.message}
              onChange={(picked) => {
                setPatient(picked);
                form.setValue("patientId", picked?.id ?? "", { shouldValidate: picked !== null });
              }}
            />
          )}
        </div>
        <Form {...form}>
          <form
            id="booking-form"
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          >
            <SelectField
              control={form.control}
              name="providerMembershipId"
              label={t("appointments.dialog.provider")}
              options={providers.map((p) => ({ value: p.membershipId, label: p.fullName }))}
            />
            {creating && services.data !== undefined && (
              <SelectField
                control={form.control}
                name="serviceId"
                label={t("appointments.dialog.service")}
                options={serviceOptions}
              />
            )}
            <TextField
              control={form.control}
              name="date"
              type="date"
              label={t("appointments.date")}
            />
            <div className="grid grid-cols-2 gap-2">
              <TextField
                control={form.control}
                name="startTime"
                type="time"
                dir="ltr"
                label={t("appointments.dialog.start")}
              />
              <TextField
                control={form.control}
                name="endTime"
                type="time"
                dir="ltr"
                label={t("appointments.dialog.end")}
              />
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              {t("appointments.dialog.endHint")}
            </p>
            {day.can.overbook && (
              <div className="sm:col-span-2">
                <SwitchField
                  control={form.control}
                  name="overbook"
                  label={t("appointments.dialog.overbook")}
                  hint={t("appointments.dialog.overbookHint")}
                />
              </div>
            )}
          </form>
        </Form>
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("appointments.dialog.cancel")}
          </Button>
          <Button type="submit" form="booking-form" disabled={mutation.isPending}>
            {t(creating ? "appointments.dialog.save" : "appointments.dialog.saveReschedule")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
