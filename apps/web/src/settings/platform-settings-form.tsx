import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { moduleSchema } from "@eyadex/contracts/clinics";
import { platformSettingsSchema, type PlatformSettings } from "@eyadex/contracts/platform";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { useApi } from "@/shared/api/api-provider";
import { errorCodeOf } from "@/shared/api/api-error";
import { NumberField, SwitchField, TextField } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { useRefreshAfterSettings } from "./settings-queries";

export function PlatformSettingsForm({ settings }: { settings: PlatformSettings }) {
  const { t, tDynamic } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const refresh = useRefreshAfterSettings();
  const form = useForm<PlatformSettings>({
    resolver: zodResolver(platformSettingsSchema),
    defaultValues: settings,
  });
  const mutation = useMutation({
    mutationFn: (input: PlatformSettings) => api.platformSettings.update(persona, input),
    onSuccess: () => {
      refresh();
      toast.success(t("platformSettings.saved"));
    },
    onError: (e) => toast.error(t(`errors.${errorCodeOf(e)}`)),
  });

  return (
    <Card className="max-w-2xl">
      <CardContent className="pt-6">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
            className="flex flex-col gap-4"
          >
            <NumberField
              control={form.control}
              name="defaultTrialDays"
              label={t("platformSettings.defaultTrialDays")}
              hint={t("platformSettings.defaultTrialDaysHint")}
            />
            <NumberField
              control={form.control}
              name="alertDaysBeforeExpiry"
              label={t("platformSettings.alertDays")}
              hint={t("platformSettings.alertDaysHint")}
            />
            <TextField
              control={form.control}
              name="emailSenderName"
              label={t("platformSettings.emailSenderName")}
              hint={t("platformSettings.emailSenderNameHint")}
            />
            <section className="flex flex-col gap-4 border-t pt-4">
              <div className="flex flex-col gap-1">
                <h2 className="font-medium">{t("platformSettings.newClinics")}</h2>
                <p className="text-sm text-muted-foreground">
                  {t("platformSettings.newClinicsHint")}
                </p>
              </div>
              <NumberField
                control={form.control}
                name="defaultMaxUsers"
                label={t("platformSettings.defaultMaxUsers")}
                hint={t("platformSettings.defaultMaxUsersHint")}
              />
              <NumberField
                control={form.control}
                name="defaultMaxBranches"
                label={t("platformSettings.defaultMaxBranches")}
                hint={t("platformSettings.defaultMaxBranchesHint")}
              />
              <p className="text-sm font-medium">{t("platformSettings.defaultModules")}</p>
              {moduleSchema.options.map((m) => (
                <SwitchField
                  key={m}
                  control={form.control}
                  name={`defaultModules.${m}`}
                  label={tDynamic(`clinics.modules.${m}`)}
                  hint={tDynamic(`clinics.modules.${m}Body`)}
                />
              ))}
            </section>
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
