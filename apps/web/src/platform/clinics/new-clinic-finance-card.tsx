import type { Control } from "react-hook-form";
import { currencyCodeSchema } from "@eyadex/contracts/money";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CreateClinicFormValues } from "@/shared/api/new-clinic-finance";
import { NumberField, SelectField } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";

/** F1 §7b: the new clinic's currency (default KWD) and tax rate in basis points (default 0). */
export function NewClinicFinanceCard({ control }: { control: Control<CreateClinicFormValues> }) {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("finance.platform.title")}</CardTitle>
        <CardDescription>{t("finance.platform.taxHint")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <SelectField
          control={control}
          name="currency"
          label={t("finance.platform.currency")}
          options={currencyCodeSchema.options.map((c) => ({ value: c, label: c }))}
        />
        <NumberField control={control} name="taxRateBp" label={t("finance.platform.taxRate")} />
      </CardContent>
    </Card>
  );
}
