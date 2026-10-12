import type { Control } from "react-hook-form";
import type { PatientInput } from "@eyadex/contracts/patients";
import { SelectField, SwitchField, TextField } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";

/** Empty select values are not allowed by the select primitive: "" travels as this token. */
const DEFAULT_TOKEN = "default";

/** N-2: where the patient's messages go, in which language, and the reminders opt-out. */
export function PatientMessagesFields({ control }: { control: Control<PatientInput> }) {
  const { t } = useI18n();
  return (
    <fieldset className="flex flex-col gap-4 border-t pt-4">
      <legend className="pe-2 text-sm font-semibold">{t("patientMessages.section")}</legend>
      <TextField
        control={control}
        name="email"
        type="email"
        dir="ltr"
        label={`${t("patientMessages.email")} (${t("common.optional")})`}
      />
      <LanguageField control={control} />
      <SwitchField
        control={control}
        name="notificationsOptOut"
        label={t("patientMessages.optOut")}
        hint={t("patientMessages.optOutHint")}
      />
    </fieldset>
  );
}

function LanguageField({ control }: { control: Control<PatientInput> }) {
  const { t } = useI18n();
  return (
    <SelectField
      control={control}
      name="messageLanguage"
      label={t("patientMessages.language")}
      options={[
        { value: DEFAULT_TOKEN, label: t("patientMessages.languageDefault") },
        { value: "ar", label: t("language.ar") },
        { value: "en", label: t("language.en") },
      ]}
      fromValue={(v) => (v === "" ? DEFAULT_TOKEN : v)}
      toValue={(v) => (v === DEFAULT_TOKEN ? "" : v)}
    />
  );
}
