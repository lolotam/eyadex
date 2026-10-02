import { useForm, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { createClinicInputSchema, type ClinicDetailsInput, type CreateClinicInput } from "@contracts/clinics";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { useApi } from "@/shared/api/api-provider";
import { errorCodeOf } from "@/shared/api/api-error";
import { TextField } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { PageHeader } from "@/shared/shell/page-header";
import { ClinicDetailsFields } from "./clinic-details-fields";
import { clinicKeys } from "./clinic-queries";

export function CreateClinicPage() {
  const { t } = useI18n();
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const form = useForm<CreateClinicInput>({
    resolver: zodResolver(createClinicInputSchema),
    defaultValues: {
      nameAr: "", nameEn: "", slug: "", specialty: "psychiatry", defaultLanguage: "ar",
      timezone: "Asia/Kuwait", adminName: "", adminEmail: "",
    },
  });

  const mutation = useMutation({
    mutationFn: (input: CreateClinicInput) => api.platform.createClinic(input),
    onSuccess: (clinic) => {
      void queryClient.invalidateQueries({ queryKey: clinicKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["login-clinics"] });
      toast.success(t("clinics.created"));
      void navigate({ to: "/platform/clinics/$clinicId", params: { clinicId: clinic.id } });
    },
    onError: (error) => {
      const code = errorCodeOf(error);
      if (code === "slug_taken") form.setError("slug", { message: "errors.slug_taken" });
      else toast.error(t(`errors.${code}`));
    },
  });

  // The create schema extends the details schema, so the shared fields accept this control.
  const detailsControl = form.control as unknown as Control<ClinicDetailsInput>;

  return (
    <div className="max-w-3xl">
      <PageHeader title={t("clinics.createTitle")} subtitle={t("clinics.createSubtitle")} />
      <Form {...form}>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="flex flex-col gap-6">
          <Card>
            <CardHeader><CardTitle className="text-base">{t("clinics.sectionClinic")}</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-4">
              <TextField control={form.control} name="slug" label={t("clinics.fields.slug")} hint={t("clinics.fields.slugHint")} dir="ltr" />
              <ClinicDetailsFields control={detailsControl} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">{t("clinics.sectionAdmin")}</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="adminName" label={t("clinics.fields.adminName")} />
              <TextField control={form.control} name="adminEmail" label={t("clinics.fields.adminEmail")} type="email" dir="ltr" />
            </CardContent>
          </Card>
          <div className="flex gap-2">
            <Button type="submit" disabled={mutation.isPending}>{t("common.create")}</Button>
            <Button type="button" variant="outline" asChild>
              <Link to="/platform/clinics">{t("common.cancel")}</Link>
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
