import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { moduleSchema, type ClinicDetail, type ClinicModule } from "@eyadex/contracts/clinics";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { errorCodeOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { clinicKeys } from "./clinic-queries";
import { moduleSwitchLocked } from "./module-switch-lock";

/** One switch per clinic module (PRD §4.8), in the order of the contract's module list. */
export function ClinicModulesTab({ clinic }: { clinic: ClinicDetail }) {
  const { t, tDynamic } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ module, enabled }: { module: ClinicModule; enabled: boolean }) =>
      api.platform.setClinicFeature(persona, clinic.id, module, enabled),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clinicKeys.detail(clinic.id) });
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      toast.success(t("clinics.modules.saved"));
    },
    onError: (e) => toast.error(t(`errors.${errorCodeOf(e)}`)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("clinics.modules.title")}</CardTitle>
        <CardDescription>{t("clinics.modules.body")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {moduleSchema.options.map((module) => (
          <div
            key={module}
            className="flex items-center justify-between gap-4 rounded-lg border p-4"
          >
            <div>
              <div className="font-medium">{tDynamic(`clinics.modules.${module}`)}</div>
              <div className="text-sm text-muted-foreground">
                {tDynamic(`clinics.modules.${module}Body`)}
              </div>
              {moduleSwitchLocked(module, clinic.features) && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {t("validation.moduleRequires")}
                </div>
              )}
            </div>
            <Switch
              checked={clinic.features[module]}
              disabled={mutation.isPending || moduleSwitchLocked(module, clinic.features)}
              onCheckedChange={(enabled) => mutation.mutate({ module, enabled })}
              aria-label={tDynamic(`clinics.modules.${module}`)}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
