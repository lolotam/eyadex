import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  clinicSettingsInputSchema,
  timezoneOptions,
  type ClinicSettings,
  type ClinicSettingsInput,
} from "@contracts/clinics";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApi } from "@/shared/api/api-provider";
import { errorCodeOf } from "@/shared/api/api-error";
import { SelectField, TextField } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { can } from "@/shared/permissions/can";
import { usePersona, useSession } from "@/shared/persona/persona-provider";
import { useRefreshAfterSettings } from "./settings-queries";

export function ClinicSettingsForm({ settings }: { settings: ClinicSettings }) {
  const { t } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const { session } = useSession();
  const refresh = useRefreshAfterSettings();
  const editable = can(session?.permissions ?? [], "update", "clinic_settings");
  const form = useForm<ClinicSettingsInput>({
    resolver: zodResolver(clinicSettingsInputSchema),
    defaultValues: {
      nameAr: settings.nameAr,
      nameEn: settings.nameEn,
      defaultLanguage: settings.defaultLanguage,
      timezone: settings.timezone,
    },
  });
  const mutation = useMutation({
    mutationFn: (input: ClinicSettingsInput) => api.clinicSettings.update(persona, input),
    onSuccess: () => {
      refresh();
      toast.success(t("clinicSettings.saved"));
    },
    onError: (e) => toast.error(t(`errors.${errorCodeOf(e)}`)),
  });

  return (
    <Card className="max-w-2xl">
      <CardContent className="pt-6">
        {!editable && (
          <p className="mb-4 text-sm text-muted-foreground">{t("clinicSettings.readOnlyNote")}</p>
        )}
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
            className="flex flex-col gap-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label>{t("clinicSettings.slug")}</Label>
                <Input value={`${settings.slug}.eyadex.com`} disabled dir="ltr" />
              </div>
              <div className="flex flex-col gap-2">
                <Label>{t("clinicSettings.specialty")}</Label>
                <Input value={t(`specialty.${settings.specialty}`)} disabled />
              </div>
              <TextField
                control={form.control}
                name="nameAr"
                label={t("clinics.fields.nameAr")}
                dir="rtl"
                disabled={!editable}
              />
              <TextField
                control={form.control}
                name="nameEn"
                label={t("clinics.fields.nameEn")}
                dir="ltr"
                disabled={!editable}
              />
              <SelectField
                control={form.control}
                name="defaultLanguage"
                label={t("clinics.fields.defaultLanguage")}
                disabled={!editable}
                options={[
                  { value: "ar", label: t("language.ar") },
                  { value: "en", label: t("language.en") },
                ]}
              />
              <SelectField
                control={form.control}
                name="timezone"
                label={t("clinics.fields.timezone")}
                disabled={!editable}
                options={timezoneOptions.map((tz) => ({ value: tz, label: tz }))}
              />
            </div>
            {editable && (
              <div>
                <Button type="submit" disabled={mutation.isPending}>
                  {t("common.save")}
                </Button>
              </div>
            )}
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
