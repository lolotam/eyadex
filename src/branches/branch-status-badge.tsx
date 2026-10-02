import { Circle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/shared/i18n/i18n-provider";

export function BranchStatusBadge({ active }: { active: boolean }) {
  const { t } = useI18n();
  return (
    <Badge variant={active ? "default" : "secondary"} className="gap-1.5 whitespace-nowrap">
      <Circle className="size-1.5 fill-current" />
      {active ? t("common.active") : t("common.inactive")}
    </Badge>
  );
}