import { Unplug } from "lucide-react";
import type { WhatsappChannelView } from "@eyadex/contracts/whatsapp";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useSession } from "@/shared/persona/persona-provider";
import { whatsappErrorKey } from "./whatsapp-error-copy";
import { WhatsappStatusBadge } from "./whatsapp-status-badge";

/** The channel at a glance: status, the transport, when it connected, the last error. */
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
            <p className="text-xs text-destructive">{t(whatsappErrorKey(view.lastError))}</p>
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
