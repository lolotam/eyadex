import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { toast } from "sonner";
import type { Appointment, AppointmentDay } from "@eyadex/contracts/appointments";
import { instantToWall } from "@eyadex/contracts/clinic-time";
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
  skippedTimeField,
  slotRefusal,
  toAppointmentInput,
  toRescheduleInput,
  type BookingForm,
  type SlotCode,
} from "./booking-form";
import { PatientPicker, type PickedPatient } from "./patient-picker";

/** A create carries the clicked slot's instant: on a fall-back day its wall time names two slots. */
export type BookingRequest =
  | { kind: "create"; providerId: string; startsAt: string }
  | { kind: "reschedule"; appointment: Appointment };

type Props = { request: BookingRequest | null; day: AppointmentDay; onClose: () => void };

function initial(request: BookingRequest, day: AppointmentDay): BookingForm {
  if (request.kind === "reschedule") return formOf(request.appointment, day.timezone);
  const provider = day.providers.find((p) => p.membershipId === request.providerId);
  const start = instantToWall(request.startsAt, day.timezone);
  return {
    patientId: "",
    providerMembershipId: request.providerId,
    serviceId: NO_SERVICE,
    date: start.date,
    startTime: start.time,
    endTime: endFor(start.time, provider?.defaultDurationMinutes ?? 20),
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
  const [refusal, setRefusal] = useState<SlotCode | null>(null);
  const creating = request?.kind === "create";
  const form = useForm<BookingForm>({ resolver: zodResolver(bookingFormSchema) });
  // A new request starts a new form and key; a refetch of the day (focus, another booking) keeps both,
  // so typed values survive and a retry replays the same key (Codex A2 r1).
  const dayRef = useRef(day);
  dayRef.current = day;
  const servicesRef = useRef(services.data);
  servicesRef.current = services.data;
  const lastPick = useRef<string | null>(null);
  useEffect(() => {
    if (request === null) return;
    key.current = crypto.randomUUID();
    setPatient(null);
    setRefusal(null);
    lastPick.current = null;
    form.reset(initial(request, dayRef.current));
  }, [request, form]);
  const [providerId, serviceId, startTime] = useWatch({
    control: form.control,
    name: ["providerMembershipId", "serviceId", "startTime"],
  });
  // Rule 4's pre-fill: the service's length, else the provider's default. Only the user's own change of
  // start, provider or service moves the end; a refetch never overwrites an end typed by hand (Codex A2 r2).
  useEffect(() => {
    const pick = `${providerId}|${serviceId}|${startTime}`;
    const previous = lastPick.current;
    lastPick.current = pick;
    if (!creating || previous === null || previous === pick) return;
    const service = servicesRef.current?.find((s) => s.id === serviceId);
    const provider = dayRef.current.providers.find((p) => p.membershipId === providerId);
    const minutes = service?.durationMinutes ?? provider?.defaultDurationMinutes ?? 20;
    if (/^\d{2}:\d{2}$/.test(startTime ?? "")) form.setValue("endTime", endFor(startTime, minutes));
  }, [creating, providerId, serviceId, startTime, form]);

  const mutation = useMutation({
    mutationFn: (values: BookingForm) =>
      request?.kind === "reschedule"
        ? api.appointments.reschedule(
            persona,
            request.appointment.id,
            toRescheduleInput(values, day.branch.id, day.timezone, request.appointment),
          )
        : api.appointments.create(
            persona,
            toAppointmentInput(
              values,
              day.branch.id,
              day.timezone,
              request?.kind === "create" ? request.startsAt : undefined,
            ),
            key.current,
          ),
    onSuccess: () => {
      refresh();
      toast.success(t(creating ? "appointments.dialog.booked" : "appointments.dialog.moved"));
      onClose();
    },
    onError: (e) => {
      const slot = slotRefusal(e);
      if (slot) setRefusal(slot);
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
            onSubmit={form.handleSubmit((values) => {
              setRefusal(null);
              const skipped = skippedTimeField(values, day.timezone);
              if (skipped) form.setError(skipped, { message: "validation.timeMissing" });
              else mutation.mutate(values);
            })}
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
            {refusal && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive sm:col-span-2"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t(`errors.${refusal}`)}
              </p>
            )}
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
