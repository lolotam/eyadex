import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ClinicDetail } from "@contracts/clinics";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { errorCodeOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { clinicKeys } from "./clinic-queries";

export function ClinicModulesTab({ clinic }: { clinic: ClinicDetail }) {
  const { t } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (enabled: boolean) =>
      api.platform.setClinicFeature(persona, clinic.id, "patients", enabled),
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
      <CardContent>
        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div>
            <div className="font-medium">{t("clinics.modules.patients")}</div>
            <div className="text-sm text-muted-foreground">{t("clinics.modules.patientsBody")}</div>
          </div>
          <Switch
            checked={clinic.features.patients}
            disabled={mutation.isPending}
            onCheckedChange={(v) => mutation.mutate(v)}
            aria-label={t("clinics.modules.patients")}
          />
        </div>
      </CardContent>
    </Card>
  );
}
