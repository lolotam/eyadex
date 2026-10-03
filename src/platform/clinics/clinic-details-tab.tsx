import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  clinicDetailsInputSchema,
  type ClinicDetail,
  type ClinicDetailsInput,
} from "@contracts/clinics";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { errorCodeOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { ClinicDetailsFields } from "./clinic-details-fields";
import { clinicKeys } from "./clinic-queries";

export function ClinicDetailsTab({ clinic }: { clinic: ClinicDetail }) {
  const { t } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const queryClient = useQueryClient();
  const form = useForm<ClinicDetailsInput>({
    resolver: zodResolver(clinicDetailsInputSchema),
    defaultValues: {
      nameAr: clinic.nameAr,
      nameEn: clinic.nameEn,
      specialty: clinic.specialty,
      defaultLanguage: clinic.defaultLanguage,
      timezone: clinic.timezone,
    },
  });

  const mutation = useMutation({
    mutationFn: (input: ClinicDetailsInput) =>
      api.platform.updateClinicDetails(persona, clinic.id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clinicKeys.all });
      toast.success(t("clinics.detailsSaved"));
    },
    onError: (e) => toast.error(t(`errors.${errorCodeOf(e)}`)),
  });

  return (
    <Card>
      <CardContent className="pt-6">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-2">
              <Label>{t("clinics.fields.slug")}</Label>
              <Input value={clinic.slug} disabled dir="ltr" />
            </div>
            <ClinicDetailsFields control={form.control} />
            <div>
              <Button type="submit" disabled={mutation.isPending}>
                {t("common.save")}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
