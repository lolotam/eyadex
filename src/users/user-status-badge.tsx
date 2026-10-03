import { CircleCheck, CircleSlash } from "lucide-react";
import type { MembershipUserStatus } from "@contracts/users";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/shared/i18n/i18n-provider";

export function UserStatusBadge({ status }: { status: MembershipUserStatus }) {
  const { t } = useI18n();
  const active = status === "active";
  const Icon = active ? CircleCheck : CircleSlash;
  return (
    <Badge variant={active ? "default" : "secondary"} className="gap-1.5 whitespace-nowrap">
      <Icon className="size-3.5" />
      {t(`users.status.${status}`)}
    </Badge>
  );
}
