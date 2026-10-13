import { useState } from "react";
import { AlertTriangle, QrCode } from "lucide-react";
import type { WhatsappChannelView } from "@eyadex/contracts/whatsapp";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/shared/i18n/i18n-provider";

/**
 * Option 1, the Evolution QR link: the risk warning comes first, and Connect stays disabled until the
 * admin accepts it (once accepted, the date shows instead of the checkbox).
 */
export function WhatsappQrCard({
  view,
  editable,
  blocked,
  busy,
  onConnect,
}: {
  view: WhatsappChannelView;
  editable: boolean;
  /** Another transport is in use: this one waits until it is disconnected. */
  blocked: boolean;
  busy: boolean;
  onConnect: () => void;
}) {
  const { t, lang } = useI18n();
  const [accepted, setAccepted] = useState(false);
  const active = view.transport === "evolution" && view.status !== "disconnected";
  const riskDone = view.riskAcceptedAt !== null;
  const date = (iso: string) =>
    new Intl.DateTimeFormat(lang === "ar" ? "ar-KW" : "en-GB", { dateStyle: "medium" }).format(
      new Date(iso),
    );
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <QrCode className="size-4" />
          {t("whatsapp.qr.title")}
          {active && <Badge variant="outline">{t("whatsapp.inUse")}</Badge>}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t("whatsapp.qr.body")}</p>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div
          role="note"
          className="flex gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-destructive">{t("whatsapp.qr.riskTitle")}</p>
            <p className="text-sm">{t("whatsapp.qr.risk")}</p>
          </div>
        </div>
        {riskDone ? (
          <p className="text-sm text-muted-foreground">
            {t("whatsapp.qr.acceptedOn", { date: date(view.riskAcceptedAt!) })}
          </p>
        ) : (
          editable && (
            <div className="flex items-start gap-2">
              <Checkbox
                id="wa-accept-risk"
                checked={accepted}
                onCheckedChange={(v) => setAccepted(v === true)}
              />
              <Label htmlFor="wa-accept-risk" className="leading-snug">
                {t("whatsapp.qr.accept")}
              </Label>
            </div>
          )
        )}
        {editable && view.status !== "connected" && (
          <div className="mt-auto flex flex-col items-start gap-1">
            <Button disabled={blocked || busy || !(riskDone || accepted)} onClick={onConnect}>
              {active && view.status === "pending"
                ? t("whatsapp.qr.showCode")
                : t("whatsapp.qr.connect")}
            </Button>
            {blocked && (
              <p className="text-xs text-muted-foreground">{t("whatsapp.otherActive")}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
