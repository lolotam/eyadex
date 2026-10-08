import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  accountProfileInputSchema,
  type AccountProfile,
  type AccountProfileInput,
} from "@eyadex/contracts/users";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { API_MODE } from "@/shared/api/api-mode";
import { useApi } from "@/shared/api/api-provider";
import { errorCodeOf } from "@/shared/api/api-error";
import { SelectField, TextField } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { ChangePasswordDialog } from "./change-password-dialog";
import { useRefreshAfterSettings } from "./settings-queries";

export function AccountForm({ profile }: { profile: AccountProfile }) {
  const { t, pick, setLang } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const refresh = useRefreshAfterSettings();
  const [passwordOpen, setPasswordOpen] = useState(false);
  // The demo has no passwords; the real sign-in (HTTP mode) changes it through Better Auth.
  const live = API_MODE === "http";
  const form = useForm<AccountProfileInput>({
    resolver: zodResolver(accountProfileInputSchema),
    defaultValues: { fullName: profile.fullName, preferredLanguage: profile.preferredLanguage },
  });
  const mutation = useMutation({
    mutationFn: (input: AccountProfileInput) => api.account.update(persona, input),
    onSuccess: (saved) => {
      setLang(saved.preferredLanguage);
      refresh();
      toast.success(t("account.saved"));
    },
    onError: (e) => toast.error(t(`errors.${errorCodeOf(e)}`)),
  });

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardContent className="pt-6">
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
              className="flex flex-col gap-4"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label>{t("account.email")}</Label>
                  <Input value={profile.email} disabled dir="ltr" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>{t("account.role")}</Label>
                  <Input value={pick(profile.roleNameAr, profile.roleNameEn)} disabled />
                </div>
                <TextField control={form.control} name="fullName" label={t("account.fullName")} />
                <SelectField
                  control={form.control}
                  name="preferredLanguage"
                  label={t("account.language")}
                  options={[
                    { value: "ar", label: t("language.ar") },
                    { value: "en", label: t("language.en") },
                  ]}
                />
              </div>
              <div>
                <Button type="submit" disabled={mutation.isPending}>
                  {t("common.save")}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <div>
            <h2 className="text-sm font-semibold">{t("account.passwordTitle")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(live ? "account.passwordNoteLive" : "account.passwordNote")}
            </p>
          </div>
          <Button variant="outline" disabled={!live} onClick={() => setPasswordOpen(true)}>
            {t("account.passwordButton")}
          </Button>
        </CardContent>
      </Card>
      {live && <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />}
    </div>
  );
}
