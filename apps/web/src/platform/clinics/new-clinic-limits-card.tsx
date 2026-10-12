import { useWatch, type Control } from "react-hook-form";
import { moduleSchema, type CreateClinicInput } from "@eyadex/contracts/clinics";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NumberField, SwitchField } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { moduleSwitchLocked } from "./module-switch-lock";

/** The new clinic's limits and modules, pre-filled from the platform settings. */
export function NewClinicLimitsCard({ control }: { control: Control<CreateClinicInput> }) {
  const { t, tDynamic } = useI18n();
  const modules = useWatch({ control, name: "modules" });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("clinics.sectionLimits")}</CardTitle>
        <CardDescription>{t("clinics.limitsHint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            control={control}
            name="maxUsers"
            label={t("clinics.subscription.maxUsers")}
          />
          <NumberField
            control={control}
            name="maxBranches"
            label={t("clinics.subscription.maxBranches")}
          />
        </div>
        {moduleSchema.options.map((m) => (
          <SwitchField
            key={m}
            control={control}
            name={`modules.${m}`}
            label={tDynamic(`clinics.modules.${m}`)}
            hint={
              moduleSwitchLocked(m, modules)
                ? `${tDynamic(`clinics.modules.${m}Body`)} · ${t("validation.moduleRequires")}`
                : tDynamic(`clinics.modules.${m}Body`)
            }
            disabled={moduleSwitchLocked(m, modules)}
          />
        ))}
      </CardContent>
    </Card>
  );
}
