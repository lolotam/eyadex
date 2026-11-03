import type { ReportAgeBucket } from "@eyadex/contracts/finance-reports";
import { Clock, Clock3, AlertTriangle, AlertOctagon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/shared/i18n/i18n-provider";

const TONE = {
  "0_30": { variant: "secondary", icon: Clock },
  "31_60": { variant: "outline", icon: Clock3 },
  "61_90": { variant: "outline", icon: AlertTriangle },
  over_90: { variant: "destructive", icon: AlertOctagon },
} as const;

/** The age of a balance: an icon and a text label with a tint, never colour alone. */
export function AgeBucketBadge({ bucket }: { bucket: ReportAgeBucket }) {
  const { t } = useI18n();
  const tone = TONE[bucket];
  const Icon = tone.icon;
  return (
    <Badge variant={tone.variant} className="gap-1 whitespace-nowrap" data-bucket={bucket}>
      <Icon className="size-3" aria-hidden />
      {t(`financeReports.outstanding.buckets.${bucket}`)}
    </Badge>
  );
}
