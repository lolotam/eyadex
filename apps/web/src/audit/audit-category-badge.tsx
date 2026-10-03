import { FileLock2, Settings2 } from "lucide-react";
import type { AuditCategory } from "@eyadex/contracts/audit";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/shared/i18n/i18n-provider";

export function AuditCategoryBadge({ category }: { category: AuditCategory }) {
  const { t } = useI18n();
  const access = category === "patient_access";
  return (
    <Badge variant={access ? "default" : "secondary"} className="gap-1.5 whitespace-nowrap">
      {access ? <FileLock2 className="size-3" /> : <Settings2 className="size-3" />}
      {t(`audit.categories.${category}`)}
    </Badge>
  );
}
