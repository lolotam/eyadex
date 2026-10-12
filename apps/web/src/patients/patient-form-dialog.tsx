import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import {
  formatFileNumber,
  genderSchema,
  patientInputSchema,
  type PatientDetail,
  type PatientInput,
} from "@eyadex/contracts/patients";
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
import { useApi } from "@/shared/api/api-provider";
import { ApiError, errorCodeOf } from "@/shared/api/api-error";
import { SelectField, TextField } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { PatientMessagesFields } from "./patient-messages-fields";
import { usePatientBranches, useRefreshPatients } from "./patient-queries";

type Props = {
  open: boolean;
  patient: PatientDetail | null;
  onOpenChange: (open: boolean) => void;
};

/** A visible file already holding this phone or civil ID: the API sends a link to it. */
type Duplicate = {
  field: "phone" | "civilId";
  patientId: string | null;
  fileNumber: number | null;
};

function blank(branchId: string): PatientInput {
  return {
    fullName: "",
    phone: "",
    birthDate: "",
    gender: "male",
    registrationBranchId: branchId,
    civilId: "",
    email: "",
    messageLanguage: "",
    notificationsOptOut: false,
  };
}

export function PatientFormDialog({ open, patient, onOpenChange }: Props) {
  const api = useApi();
  const { persona } = usePersona();
  const { t, pick } = useI18n();
  const refresh = useRefreshPatients();
  const branches = usePatientBranches(patient ? "update" : "create", open);
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);
  // One key per opening of the dialog: a retried submission replays the first create.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const form = useForm<PatientInput>({
    resolver: zodResolver(patientInputSchema),
    defaultValues: blank(""),
  });

  // Active branches only, plus the patient's current branch so an edit can keep it.
  const options = (branches.data ?? [])
    .filter((b) => b.isActive || b.id === patient?.registrationBranchId)
    .map((b) => ({ value: b.id, label: pick(b.nameAr, b.nameEn) }));
  const firstBranch = options[0]?.value ?? "";

  // Reset only for a new opening (or a different patient), never when branches arrive later.
  const patientRef = useRef(patient);
  patientRef.current = patient;
  const patientId = patient?.id ?? null;
  useEffect(() => {
    if (!open) return;
    const current = patientRef.current;
    setDuplicate(null);
    setIdempotencyKey(crypto.randomUUID());
    form.reset(
      current
        ? {
            fullName: current.fullName,
            phone: current.phone,
            birthDate: current.birthDate,
            gender: current.gender,
            registrationBranchId: current.registrationBranchId,
            civilId: current.civilId ?? "",
            email: current.email ?? "",
            messageLanguage: current.messageLanguage ?? "",
            notificationsOptOut: current.notificationsOptOut,
          }
        : blank(""),
    );
  }, [open, patientId, form]);

  // Once branches load, fill the default branch only if the user hasn't picked one.
  useEffect(() => {
    if (!open || patientId || !firstBranch) return;
    if (!form.getValues("registrationBranchId"))
      form.setValue("registrationBranchId", firstBranch, { shouldDirty: false });
  }, [open, patientId, firstBranch, form]);

  const mutation = useMutation({
    mutationFn: (input: PatientInput) =>
      patient
        ? api.patients.update(persona, patient.id, input)
        : api.patients.create(persona, input, idempotencyKey),
    onSuccess: (result) => {
      refresh(result);
      toast.success(t(patient ? "patients.updated" : "patients.created"));
      onOpenChange(false);
    },
    onError: (error) => {
      if (
        error instanceof ApiError &&
        (error.code === "patient_phone_taken" || error.code === "patient_civil_id_taken")
      ) {
        const id = error.details["patientId"];
        const no = error.details["fileNumber"];
        setDuplicate({
          field: error.code === "patient_phone_taken" ? "phone" : "civilId",
          patientId: typeof id === "string" ? id : null,
          fileNumber: typeof no === "number" ? no : null,
        });
        return;
      }
      toast.error(t(`errors.${errorCodeOf(error)}`));
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg sm:max-w-lg">
        <DialogHeader className="text-start">
          <DialogTitle>{t(patient ? "patients.editTitle" : "patients.createTitle")}</DialogTitle>
          <DialogDescription>
            {patient
              ? `${t("patients.columns.fileNumber")} ${formatFileNumber(patient.fileNumber)}`
              : t("patients.formSubtitle")}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id="patient-form"
            className="flex flex-col gap-4 py-2"
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          >
            <TextField
              control={form.control}
              name="fullName"
              label={t("patients.fields.fullName")}
            />
            <TextField
              control={form.control}
              name="phone"
              label={t("patients.fields.phone")}
              hint={t("patients.fields.phoneHint")}
              type="tel"
              dir="ltr"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="birthDate"
                label={t("patients.fields.birthDate")}
                type="date"
              />
              <SelectField
                control={form.control}
                name="gender"
                label={t("patients.fields.gender")}
                options={genderSchema.options.map((g) => ({
                  value: g,
                  label: t(`patients.gender.${g}`),
                }))}
              />
            </div>
            <SelectField
              control={form.control}
              name="registrationBranchId"
              label={t("patients.fields.branch")}
              options={options}
            />
            <TextField
              control={form.control}
              name="civilId"
              label={`${t("patients.fields.civilId")} (${t("common.optional")})`}
              hint={t("patients.fields.civilIdHint")}
              dir="ltr"
            />
            <PatientMessagesFields control={form.control} />
          </form>
        </Form>
        {duplicate && (
          <div className="flex flex-wrap items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span className="flex-1">
              {t(duplicate.field === "phone" ? "patients.phoneTaken" : "patients.civilIdTaken")}
            </span>
            {duplicate.patientId && duplicate.fileNumber !== null && (
              <Link
                to="/clinic/patients/$patientId"
                params={{ patientId: duplicate.patientId }}
                className="font-medium underline underline-offset-2"
                onClick={() => onOpenChange(false)}
              >
                {t("patients.phoneTakenFile", {
                  fileNumber: formatFileNumber(duplicate.fileNumber),
                })}
              </Link>
            )}
          </div>
        )}
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="patient-form" disabled={mutation.isPending}>
            {patient ? t("common.save") : t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
