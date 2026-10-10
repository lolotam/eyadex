import { useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  formatFileNumber,
  patientInputSchema,
  type PatientInput,
} from "@eyadex/contracts/patients";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { SelectField, TextField } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import type { PickedPatient } from "./patient-picker";

type Props = {
  branchId: string;
  onCreated: (patient: PickedPatient) => void;
  onBack: () => void;
};

/**
 * D-10: a new file from the booking dialog through the patients API (`create:patients`, its own
 * Idempotency-Key, the duplicate-phone rule). The patients use case also needs the birth date and
 * gender (ADR-0026 §11); the civil ID is completed later.
 */
export function QuickFileForm({ branchId, onCreated, onBack }: Props) {
  const api = useApi();
  const { persona } = usePersona();
  const { t } = useI18n();
  const key = useRef(crypto.randomUUID());
  const form = useForm<PatientInput>({
    resolver: zodResolver(patientInputSchema),
    defaultValues: {
      fullName: "",
      phone: "",
      birthDate: "",
      gender: "female",
      registrationBranchId: branchId,
      civilId: "",
    },
  });
  const mutation = useMutation({
    mutationFn: (values: PatientInput) => api.patients.create(persona, values, key.current),
    onSuccess: (result, values) => {
      const fileNumber = formatFileNumber(result.fileNumber);
      toast.success(t("appointments.quickFile.created", { fileNumber }));
      onCreated({ id: result.id, label: `${values.fullName} · ${fileNumber}` });
    },
    onError: (e) => {
      const code = errorCodeOf(e);
      if (code === "patient_phone_taken") form.setError("phone", { message: `errors.${code}` });
      else toast.error(t(`errors.${code}`));
    },
  });
  return (
    <div className="rounded-lg border p-3">
      <p className="text-sm font-medium">{t("appointments.quickFile.title")}</p>
      <p className="mb-3 text-xs text-muted-foreground">{t("appointments.quickFile.hint")}</p>
      <Form {...form}>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            // Never submits the booking form around it.
            e.stopPropagation();
            void form.handleSubmit((values) => mutation.mutate(values))(e);
          }}
        >
          <div className="sm:col-span-2">
            <TextField
              control={form.control}
              name="fullName"
              label={t("patients.fields.fullName")}
            />
          </div>
          <TextField
            control={form.control}
            name="phone"
            dir="ltr"
            label={t("patients.fields.phone")}
            hint={t("patients.fields.phoneHint")}
          />
          <TextField
            control={form.control}
            name="birthDate"
            type="date"
            label={t("patients.fields.birthDate")}
          />
          <SelectField
            control={form.control}
            name="gender"
            label={t("patients.fields.gender")}
            options={(["female", "male"] as const).map((g) => ({
              value: g,
              label: t(`patients.gender.${g}`),
            }))}
          />
          <div className="flex items-end justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="ghost" onClick={onBack}>
              {t("appointments.patientPicker.backToSearch")}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {t("appointments.quickFile.create")}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
