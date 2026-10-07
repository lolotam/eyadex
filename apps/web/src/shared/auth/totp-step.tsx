import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { TextField } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";

const codeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "auth.validation.code"),
});
type CodeInput = z.infer<typeof codeSchema>;

/** The 6-digit code step, used after sign-in and to finish enrolment. No trust-device option. */
export function TotpStep(props: {
  title: string;
  body: string;
  pending: boolean;
  error: string | null;
  onSubmit: (code: string) => void;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const form = useForm<CodeInput>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: "" },
  });
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="font-medium">{props.title}</p>
        <p className="text-sm text-muted-foreground">{props.body}</p>
      </div>
      {props.children}
      <Form {...form}>
        <form
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit((v) => props.onSubmit(v.code))}
        >
          <TextField control={form.control} name="code" dir="ltr" label={t("auth.totpCode")} />
          {props.error && (
            <p role="alert" className="text-sm text-destructive">
              {props.error}
            </p>
          )}
          <Button type="submit" disabled={props.pending}>
            {t("auth.verify")}
          </Button>
        </form>
      </Form>
    </div>
  );
}
