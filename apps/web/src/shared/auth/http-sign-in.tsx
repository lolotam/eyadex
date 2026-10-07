import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import type { Area } from "@/shared/api/area-host";
import { TextField } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { DEFAULT_PERSONA, SESSION_KEY } from "@/shared/persona/persona-context";
import { QrCode } from "./qr-code";
import { TotpStep } from "./totp-step";
import { useAuthClient } from "./use-auth-client";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email("validation.email"),
  password: z.string().min(1, "validation.required"),
});
type Credentials = z.infer<typeof credentialsSchema>;
type Step = { kind: "password" } | { kind: "verify" } | { kind: "enroll"; uri: string | null };

/** Email + password; on the platform, then the mandatory second factor (enrol on first sign-in). */
export function HttpSignIn({ area }: { area: Area }) {
  const { t } = useI18n();
  const auth = useAuthClient();
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>({ kind: "password" });
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Credentials>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: { email: "", password: "" },
  });

  async function run(task: () => Promise<void>) {
    setPending(true);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(t(`errors.${errorCodeOf(e)}`));
    } finally {
      setPending(false);
    }
  }

  async function enter() {
    await queryClient.resetQueries({ queryKey: SESSION_KEY });
    void navigate({ to: area === "platform" ? "/platform" : "/clinic" });
  }

  const signIn = (v: Credentials) =>
    run(async () => {
      const answer = await auth.signIn(v.email, v.password);
      if ("twoFactorRedirect" in answer) return setStep({ kind: "verify" });
      if (area === "clinic") return enter();
      // A platform account without a second factor yet must enrol before anything else.
      try {
        await api.session.getContext(DEFAULT_PERSONA);
        await enter();
      } catch (e) {
        if (errorCodeOf(e) !== "two_factor_required") throw e;
        setPassword(v.password);
        setStep({ kind: "enroll", uri: null });
      }
    });

  const verify = (code: string) =>
    run(async () => {
      await auth.verifyTotp(code);
      setPassword("");
      await enter();
    });

  if (step.kind === "verify") {
    return (
      <TotpStep
        title={t("auth.totpTitle")}
        body={t("auth.totpBody")}
        pending={pending}
        error={error}
        onSubmit={(code) => void verify(code)}
      />
    );
  }
  if (step.kind === "enroll") {
    const uri = step.uri;
    if (uri === null) {
      return (
        <div className="flex flex-col gap-3">
          <p className="font-medium">{t("auth.enrollTitle")}</p>
          <p className="text-sm text-muted-foreground">{t("auth.enrollPasswordHint")}</p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button
            disabled={pending}
            onClick={() =>
              void run(async () => setStep({ kind: "enroll", uri: await auth.enableTotp(password) }))
            }
          >
            {t("auth.enrollStart")}
          </Button>
        </div>
      );
    }
    const secret = new URL(uri).searchParams.get("secret") ?? "";
    return (
      <TotpStep
        title={t("auth.enrollTitle")}
        body={t("auth.enrollBody")}
        pending={pending}
        error={error}
        onSubmit={(code) => void verify(code)}
      >
        <div className="flex flex-col items-center gap-2">
          <QrCode value={uri} label={t("auth.qrLabel")} />
          <p className="text-xs text-muted-foreground">{t("auth.manualKey")}</p>
          <code dir="ltr" className="break-all rounded-sm bg-muted px-2 py-1 text-xs">
            {secret}
          </code>
        </div>
      </TotpStep>
    );
  }
  return (
    <Form {...form}>
      <form className="flex flex-col gap-4" onSubmit={form.handleSubmit((v) => void signIn(v))}>
        <TextField control={form.control} name="email" type="email" dir="ltr" label={t("auth.email")} />
        <TextField
          control={form.control}
          name="password"
          type="password"
          dir="ltr"
          label={t("auth.password")}
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending}>
          {t("auth.signIn")}
        </Button>
      </form>
    </Form>
  );
}
