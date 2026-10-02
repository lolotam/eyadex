import type { ClinicStatus } from "@contracts/clinics";
import { Circle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/shared/i18n/i18n-provider";

const variants: Record<ClinicStatus, "default" | "secondary" | "destructive"> = {
  active: "default",
  trial: "secondary",
  suspended: "destructive",
};

export function ClinicStatusBadge({ status }: { status: ClinicStatus }) {
  const { t } = useI18n();
  return (
    <Badge variant={variants[status]} className="gap-1.5 font-medium">
      <Circle className="size-1.5 fill-current" />
      {t(`clinicStatus.${status}`)}
    </Badge>
  );
}
