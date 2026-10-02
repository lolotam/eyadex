import type { ClinicStatus } from "@contracts/clinics";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/shared/i18n/i18n-provider";

const variants: Record<ClinicStatus, "default" | "secondary" | "destructive"> = {
  active: "default",
  trial: "secondary",
  suspended: "destructive",
};

export function ClinicStatusBadge({ status }: { status: ClinicStatus }) {
  const { t } = useI18n();
  return <Badge variant={variants[status]}>{t(`clinicStatus.${status}`)}</Badge>;
}
