import { Archive, Circle } from "lucide-react";
import type { PatientStatus } from "@eyadex/contracts/patients";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/shared/i18n/i18n-provider";

export function PatientStatusBadge({ status }: { status: PatientStatus }) {
  const { t } = useI18n();
  const active = status === "active";
  return (
    <Badge variant={active ? "default" : "secondary"} className="gap-1.5 whitespace-nowrap">
      {active ? <Circle className="size-1.5 fill-current" /> : <Archive className="size-3" />}
      {t(`patients.status.${status}`)}
    </Badge>
  );
}
