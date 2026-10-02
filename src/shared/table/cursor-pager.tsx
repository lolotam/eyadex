import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/i18n-provider";

type Props = { count: number; total: number; canPrevious: boolean; canNext: boolean; onPrevious: () => void; onNext: () => void };

export function CursorPager({ count, total, canPrevious, canNext, onPrevious, onNext }: Props) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between gap-2 pt-4 text-sm text-muted-foreground">
      <span>{t("common.showing", { count, total })}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onPrevious} disabled={!canPrevious}>
          <ChevronLeft className="size-4 rtl:rotate-180" />
          {t("common.previous")}
        </Button>
        <Button variant="outline" size="sm" onClick={onNext} disabled={!canNext}>
          {t("common.next")}
          <ChevronRight className="size-4 rtl:rotate-180" />
        </Button>
      </div>
    </div>
  );
}
