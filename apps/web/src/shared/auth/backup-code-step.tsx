import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { TextField } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";

const backupSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "auth.validation.backupCode")
    .max(64, "auth.validation.backupCode"),
});
type BackupInput = z.infer<typeof backupSchema>;

/** The second step with a recovery code instead of the authenticator. No trust-device option. */
export function BackupCodeStep(props: {
  pending: boolean;
  error: string | null;
  onSubmit: (code: string) => void;
  onUseTotp: () => void;
}) {
  const { t } = useI18n();
  const form = useForm<BackupInput>({
    resolver: zodResolver(backupSchema),
    defaultValues: { code: "" },
  });
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="font-medium">{t("auth.backupTitle")}</p>
        <p className="text-sm text-muted-foreground">{t("auth.backupBody")}</p>
      </div>
      <Form {...form}>
        <form
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit((v) => props.onSubmit(v.code))}
        >
          <TextField control={form.control} name="code" dir="ltr" label={t("auth.backupCode")} />
          {props.error && (
            <p role="alert" className="text-sm text-destructive">
              {props.error}
            </p>
          )}
          <Button type="submit" disabled={props.pending}>
            {t("auth.verify")}
          </Button>
          <Button type="button" variant="link" onClick={props.onUseTotp}>
            {t("auth.useTotp")}
          </Button>
        </form>
      </Form>
    </div>
  );
}
