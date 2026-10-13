import { CircleCheck, CircleSlash, Clock } from "lucide-react";
import type { WhatsappChannelView, WhatsappStatus } from "@eyadex/contracts/whatsapp";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/shared/i18n/i18n-provider";

const LOOK: Record<
  WhatsappStatus,
  { icon: typeof Clock; variant: "default" | "secondary" | "outline" }
> = {
  disconnected: { icon: CircleSlash, variant: "secondary" },
  pending: { icon: Clock, variant: "outline" },
  connected: { icon: CircleCheck, variant: "default" },
};

export function WhatsappStatusBadge({ view }: { view: WhatsappChannelView }) {
  const { t } = useI18n();
  const { icon: Icon, variant } = LOOK[view.status];
  return (
    <Badge variant={variant} className="gap-1.5 whitespace-nowrap">
      <Icon className="size-3" />
      {t(`whatsapp.status.${view.status}`)}
      {view.status === "connected" && view.phoneLast4 && <span dir="ltr">…{view.phoneLast4}</span>}
    </Badge>
  );
}
