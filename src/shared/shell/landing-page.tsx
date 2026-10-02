import { Stethoscope } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { LanguageSwitch } from "@/shared/i18n/language-switch";
import { PersonaPicker } from "@/shared/persona/persona-picker";

export function LandingPage() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex justify-end p-4">
        <LanguageSwitch />
      </div>
      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        <Card className="w-full max-w-sm">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Stethoscope className="size-6" />
            </div>
            <CardTitle className="text-2xl">{t("app.name")}</CardTitle>
            <CardDescription>{t("landing.body")}</CardDescription>
          </CardHeader>
          <CardContent>
            <PersonaPicker />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
