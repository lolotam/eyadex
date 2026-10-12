import { CircleCheck, CircleSlash, Clock, Unplug } from "lucide-react";
import type { WhatsappChannelView, WhatsappStatus } from "@eyadex/contracts/whatsapp";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useSession } from "@/shared/persona/persona-provider";

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

/** The channel at a glance: status, the transport, when it connected, the last error code. */
export function WhatsappStatusCard({
  view,
  editable,
  onDisconnect,
}: {
  view: WhatsappChannelView;
  editable: boolean;
  onDisconnect: () => void;
}) {
  const { t, lang } = useI18n();
  const { session } = useSession();
  const time = (iso: string) =>
    new Intl.DateTimeFormat(lang === "ar" ? "ar-KW" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: session?.clinic?.timezone ?? "Asia/Kuwait",
    }).format(new Date(iso));
  return (
    <Card>
      <CardContent className="flex flex-wrap items-start justify-between gap-4 pt-6">
        <div className="flex flex-col gap-1.5">
          <WhatsappStatusBadge view={view} />
          {view.transport && view.status !== "disconnected" && (
            <p className="text-sm">
              <span className="text-muted-foreground">{t("whatsapp.connection")}: </span>
              {t(`whatsapp.transport.${view.transport}`)}
            </p>
          )}
          {view.status === "connected" && view.phoneLast4 && (
            <p className="text-sm text-muted-foreground">
              {t("whatsapp.number", { last4: view.phoneLast4 })}
            </p>
          )}
          {view.connectedAt && (
            <p className="text-xs text-muted-foreground">
              {t("whatsapp.connectedAt", { time: time(view.connectedAt) })}
            </p>
          )}
          {view.lastError && (
            <p className="text-xs text-destructive">
              {t("whatsapp.lastError", { code: view.lastError })}
            </p>
          )}
        </div>
        {editable && view.status !== "disconnected" && (
          <Button variant="outline" size="sm" onClick={onDisconnect}>
            <Unplug className="size-4" />
            {t("whatsapp.disconnect")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
