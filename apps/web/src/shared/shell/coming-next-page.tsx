import { Hourglass } from "lucide-react";
import { useI18n } from "@/shared/i18n/i18n-provider";
import type { TranslationKey } from "@/shared/i18n/dictionary";
import { StatusPanel } from "./status-panel";

export function ComingNextPage({ title }: { title: TranslationKey }) {
  const { t } = useI18n();
  return (
    <StatusPanel
      icon={Hourglass}
      title={`${t(title)} — ${t("comingNext.title")}`}
      body={t("comingNext.body")}
    />
  );
}
