import { CircleCheck, Clock, Hourglass, XCircle, type LucideIcon } from "lucide-react";
import type { InvitationStatus } from "@contracts/invitations";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/shared/i18n/i18n-provider";

const ICONS: Record<InvitationStatus, LucideIcon> = {
  pending: Clock,
  accepted: CircleCheck,
  cancelled: XCircle,
  expired: Hourglass,
};

export function InvitationStatusBadge({ status }: { status: InvitationStatus }) {
  const { t } = useI18n();
  const Icon = ICONS[status];
  return (
    <Badge
      variant={status === "pending" ? "default" : status === "expired" ? "outline" : "secondary"}
      className="gap-1.5 whitespace-nowrap"
    >
      <Icon className="size-3.5" />
      {t(`users.invitationStatus.${status}`)}
    </Badge>
  );
}
