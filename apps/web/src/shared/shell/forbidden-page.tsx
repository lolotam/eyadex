import { Link } from "@tanstack/react-router";
import { ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { StatusPanel } from "./status-panel";

export function ForbiddenPage() {
  const { t } = useI18n();
  const { persona } = usePersona();
  return (
    <StatusPanel
      icon={ShieldOff}
      title={t("forbidden.title")}
      body={t("forbidden.body")}
      action={
        <Button asChild>
          <Link to={persona.kind === "platform_admin" ? "/platform" : "/clinic"}>
            {t("forbidden.home")}
          </Link>
        </Button>
      }
    />
  );
}
