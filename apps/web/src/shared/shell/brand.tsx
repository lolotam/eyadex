import { useI18n } from "@/shared/i18n/i18n-provider";
import type { TranslationKey } from "@/shared/i18n/dictionary";

export function Brand({
  areaLabel,
  subtitle,
}: {
  areaLabel: TranslationKey;
  subtitle?: string | undefined;
}) {
  const { t } = useI18n();
  return (
    <div className="flex h-20 items-center gap-3 border-b border-sidebar-border px-5">
      <div className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <img src="/brand/eyadex-mark-white.svg" alt="" width={14} height={19} />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-sidebar-foreground">{t("app.name")}</div>
        <div className="truncate text-xs text-muted-foreground">{subtitle ?? t(areaLabel)}</div>
      </div>
    </div>
  );
}
