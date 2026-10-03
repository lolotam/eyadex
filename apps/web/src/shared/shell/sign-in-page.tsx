import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSearch } from "@tanstack/react-router";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { LanguageSwitch } from "@/shared/i18n/language-switch";
import { PersonaPicker } from "@/shared/persona/persona-picker";

export function SignInPage() {
  const { t } = useI18n();
  const search = useSearch({ strict: false });
  const disabled = (search as { reason?: string }).reason === "disabled";
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex justify-end p-4">
        <LanguageSwitch />
      </div>
      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        <Card className="w-full max-w-sm">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <img src="/brand/eyadex-mark-white.svg" alt="" width={18} height={24} />
            </div>
            <CardTitle className="text-2xl">{t("app.name")}</CardTitle>
            <CardDescription>{t("landing.body")}</CardDescription>
          </CardHeader>
          <CardContent>
            {disabled && (
              <p
                role="alert"
                className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                {t("persona.disabledNotice")}
              </p>
            )}
            <PersonaPicker />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
