import { Building2, ChevronDown } from "lucide-react";
import type { WhatsappChannelView } from "@eyadex/contracts/whatsapp";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { WhatsappSignupPanel } from "./whatsapp-signup-panel";

/** Option 2, WhatsApp Business: one-click Meta signup, the manual form under "Advanced". */
export function WhatsappBusinessCard({
  view,
  editable,
  blocked,
  onEdit,
}: {
  view: WhatsappChannelView;
  editable: boolean;
  blocked: boolean;
  onEdit: () => void;
}) {
  const { t } = useI18n();
  const active = view.transport === "coexistence" && view.status !== "disconnected";
  const connected = view.transport === "coexistence" && view.status === "connected";
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="size-4" />
          {t("whatsapp.business.title")}
          {active && <Badge variant="outline">{t("whatsapp.inUse")}</Badge>}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t("whatsapp.business.body")}</p>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        {connected && (
          <p className="text-sm font-medium">
            {t("whatsapp.signup.connectedTo", { last4: view.phoneLast4 ?? "" })}
          </p>
        )}
        <p className="text-sm text-muted-foreground">{t("whatsapp.business.templatesHelp")}</p>
        {editable && (
          <div className="mt-auto flex flex-col items-start gap-3">
            {connected ? (
              <Button variant="outline" onClick={onEdit}>
                {t("whatsapp.signup.editTemplates")}
              </Button>
            ) : (
              <WhatsappSignupPanel blocked={blocked} onConnected={onEdit} />
            )}
            {blocked && (
              <p className="text-xs text-muted-foreground">{t("whatsapp.otherActive")}</p>
            )}
            <Collapsible className="w-full">
              <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                <ChevronDown className="size-4" />
                {t("whatsapp.signup.advanced")}
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <Button variant="outline" disabled={blocked} onClick={onEdit}>
                  {view.transport === "coexistence"
                    ? t("whatsapp.business.edit")
                    : t("whatsapp.business.set")}
                </Button>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
