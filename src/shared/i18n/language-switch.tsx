import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "./i18n-provider";

export function LanguageSwitch() {
  const { lang, setLang, t } = useI18n();
  const next = lang === "ar" ? "en" : "ar";
  return (
    <Button variant="ghost" size="sm" className="gap-2" onClick={() => setLang(next)} aria-label={t("language.switch")}>
      <Languages className="size-4" />
      {t(`language.${next}`)}
    </Button>
  );
}
