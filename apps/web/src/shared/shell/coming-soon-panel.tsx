import { Hourglass } from "lucide-react";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { StatusPanel } from "./status-panel";

/** HTTP mode: a section whose API route does not exist yet. Calm, not an error. */
export function ComingSoonPanel() {
  const { t } = useI18n();
  return <StatusPanel icon={Hourglass} title={t("comingSoon.title")} body={t("comingSoon.body")} />;
}
