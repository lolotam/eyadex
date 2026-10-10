import { CircleSlash, FilePen, FileCheck2 } from "lucide-react";
import type { VisitStatus } from "@eyadex/contracts/visits";
import { useI18n } from "@/shared/i18n/i18n-provider";

const LOOK: Record<VisitStatus, { icon: typeof FilePen; tint: string }> = {
  draft: { icon: FilePen, tint: "border-amber-300 bg-amber-50 text-amber-800" },
  signed: { icon: FileCheck2, tint: "border-primary/30 bg-primary/5 text-primary" },
  cancelled: { icon: CircleSlash, tint: "border-border bg-muted text-muted-foreground" },
};

/** Status as icon + label + subtle tint, never color alone. */
export function VisitStatusBadge({ status }: { status: VisitStatus }) {
  const { t } = useI18n();
  const look = LOOK[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${look.tint}`}
    >
      <look.icon className="size-3.5" aria-hidden />
      {t(`visits.status.${status}`)}
    </span>
  );
}
