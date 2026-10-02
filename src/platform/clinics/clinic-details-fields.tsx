import type { Control } from "react-hook-form";
import { specialtySchema, timezoneOptions, type ClinicDetailsInput } from "@contracts/clinics";
import { SelectField, TextField } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";

/** Fields shared by "create clinic" and the clinic Details tab. */
export function ClinicDetailsFields({ control }: { control: Control<ClinicDetailsInput> }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField control={control} name="nameAr" label={t("clinics.fields.nameAr")} dir="rtl" />
      <TextField control={control} name="nameEn" label={t("clinics.fields.nameEn")} dir="ltr" />
      <SelectField
        control={control}
        name="specialty"
        label={t("clinics.fields.specialty")}
        options={specialtySchema.options.map((s) => ({ value: s, label: t(`specialty.${s}`) }))}
      />
      <SelectField
        control={control}
        name="defaultLanguage"
        label={t("clinics.fields.defaultLanguage")}
        options={[
          { value: "ar", label: t("language.ar") },
          { value: "en", label: t("language.en") },
        ]}
      />
      <SelectField
        control={control}
        name="timezone"
        label={t("clinics.fields.timezone")}
        options={timezoneOptions.map((tz) => ({ value: tz, label: tz }))}
      />
    </div>
  );
}
