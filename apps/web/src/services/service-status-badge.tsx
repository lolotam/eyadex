import { Circle } from "lucide-react";
import type { ServiceStatus } from "@eyadex/contracts/services";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/shared/i18n/i18n-provider";

export function ServiceStatusBadge({ status }: { status: ServiceStatus }) {
  const { t } = useI18n();
  return (
    <Badge
      variant={status === "active" ? "default" : "secondary"}
      className="gap-1.5 whitespace-nowrap"
    >
      <Circle className="size-1.5 fill-current" />
      {t(`services.status.${status}`)}
    </Badge>
  );
}
