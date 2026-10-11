import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  medicineInputSchema,
  type Medicine,
  type MedicineInput,
} from "@eyadex/contracts/medicines";
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
import { TextField } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { medicalKeys, useClinicPersona, useRefreshMedical } from "./medical-queries";

const EMPTY: MedicineInput = { name: "", defaultDose: null, defaultFrequency: null };
const orNull = (v: string | null) => (v && v.trim() ? v : null);

export function MedicineDialog({
  open,
  medicine,
  onOpenChange,
}: {
  open: boolean;
  medicine: Medicine | null;
  onOpenChange: (open: boolean) => void;
}) {
  const api = useApi();
  const { persona } = useClinicPersona();
  const { t } = useI18n();
  const refresh = useRefreshMedical();
  const form = useForm<MedicineInput>({
    resolver: zodResolver(medicineInputSchema),
    defaultValues: EMPTY,
  });
  const [key, setKey] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (open) setKey(crypto.randomUUID());
    form.reset(
      medicine
        ? {
            name: medicine.name,
            defaultDose: medicine.defaultDose,
            defaultFrequency: medicine.defaultFrequency,
          }
        : EMPTY,
    );
  }, [open, medicine, form]);
  const save = useMutation({
    mutationFn: (raw: MedicineInput) => {
      const input = {
        ...raw,
        defaultDose: orNull(raw.defaultDose),
        defaultFrequency: orNull(raw.defaultFrequency),
      };
      return medicine
        ? api.medical.updateMedicine(persona, medicine.id, input)
        : api.medical.createMedicine(persona, input, key);
    },
    onSuccess: () => {
      refresh(medicalKeys.medicines);
      toast.success(t(medicine ? "medicines.updated" : "medicines.created"));
      onOpenChange(false);
    },
    onError: (e) => toast.error(t(`errors.${errorCodeOf(e)}`)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] rounded-lg sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>{t(medicine ? "medicines.editTitle" : "medicines.createTitle")}</DialogTitle>
          <DialogDescription>{t("medicines.formSubtitle")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id="medicine-form"
            className="flex flex-col gap-4 py-2"
            onSubmit={form.handleSubmit((v) => save.mutate(v))}
          >
            <TextField control={form.control} name="name" label={t("medicines.fields.name")} />
            <TextField
              control={form.control}
              name="defaultDose"
              label={t("medicines.fields.defaultDose")}
            />
            <TextField
              control={form.control}
              name="defaultFrequency"
              label={t("medicines.fields.defaultFrequency")}
            />
          </form>
        </Form>
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="medicine-form" disabled={save.isPending}>
            {medicine ? t("common.save") : t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
