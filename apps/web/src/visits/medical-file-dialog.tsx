import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  medicalProfileInputSchema,
  type MedicalProfile,
  type MedicalProfileInput,
} from "@eyadex/contracts/medical-profile";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { FieldError } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { PROFILE_SECTIONS } from "./medical-file-sections";
import { medicalKeys, useClinicPersona, useRefreshMedical } from "./medical-queries";

type Props = {
  open: boolean;
  patientId: string;
  profile: MedicalProfile["profile"];
  onOpenChange: (open: boolean) => void;
};

export function MedicalFileDialog({ open, patientId, profile, onOpenChange }: Props) {
  const api = useApi();
  const { persona } = useClinicPersona();
  const { t } = useI18n();
  const refresh = useRefreshMedical();
  const form = useForm<MedicalProfileInput>({
    resolver: zodResolver(medicalProfileInputSchema),
    defaultValues: profile,
  });
  useEffect(() => {
    if (open) form.reset(profile);
  }, [open, profile, form]);

  const mutation = useMutation({
    mutationFn: (input: MedicalProfileInput) =>
      api.medical.saveMedicalProfile(persona, patientId, input),
    onSuccess: () => {
      refresh(medicalKeys.profile(patientId));
      toast.success(t("medicalFile.saved"));
      onOpenChange(false);
    },
    onError: (e) => toast.error(t(`errors.${errorCodeOf(e)}`)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg sm:max-w-lg">
        <DialogHeader className="text-start">
          <DialogTitle>{t("medicalFile.editTitle")}</DialogTitle>
          <DialogDescription>{t("medicalFile.editBody")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id="medical-file-form"
            className="flex flex-col gap-4 py-2"
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          >
            {PROFILE_SECTIONS.map((key) => (
              <FormField
                key={key}
                control={form.control}
                name={key}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t(`medicalFile.sections.${key}`)}</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        {...field}
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(e.target.value === "" ? null : e.target.value)
                        }
                      />
                    </FormControl>
                    <FieldError />
                  </FormItem>
                )}
              />
            ))}
          </form>
        </Form>
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="medical-file-form" disabled={mutation.isPending}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
