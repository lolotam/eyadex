import { Circle, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/shared/i18n/i18n-provider";

export function RoleStatusBadge({ active, locked }: { active: boolean; locked: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant={active ? "default" : "secondary"} className="gap-1.5 whitespace-nowrap">
        <Circle className="size-1.5 fill-current" />
        {active ? t("common.active") : t("common.inactive")}
      </Badge>
      {locked && (
        <Badge variant="outline" className="gap-1 whitespace-nowrap">
          <Lock className="size-3" />
          {t("roles.locked")}
        </Badge>
      )}
    </div>
  );
}
