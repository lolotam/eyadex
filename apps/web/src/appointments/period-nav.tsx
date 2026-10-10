import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  label: string;
  previousLabel: string;
  nextLabel: string;
  currentLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  onCurrent: () => void;
};

/** Previous / current / next for the week and month (arrows mirror in RTL). */
export function PeriodNav(p: Props) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="icon" aria-label={p.previousLabel} onClick={p.onPrevious}>
        <ChevronLeft className="size-4 rtl:rotate-180" />
      </Button>
      <span className="min-w-28 px-2 text-center text-sm font-medium">{p.label}</span>
      <Button variant="outline" size="icon" aria-label={p.nextLabel} onClick={p.onNext}>
        <ChevronRight className="size-4 rtl:rotate-180" />
      </Button>
      <Button variant="ghost" onClick={p.onCurrent}>
        {p.currentLabel}
      </Button>
    </div>
  );
}
