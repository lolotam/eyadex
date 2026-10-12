import { Building2 } from "lucide-react";
import type { WhatsappChannelView } from "@eyadex/contracts/whatsapp";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/shared/i18n/i18n-provider";

/** Option 2, WhatsApp Business (coexistence): Meta credentials and the templates, in a dialog. */
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
        <p className="text-sm text-muted-foreground">{t("whatsapp.business.templatesHelp")}</p>
        {editable && (
          <div className="mt-auto flex flex-col items-start gap-1">
            <Button variant="outline" disabled={blocked} onClick={onEdit}>
              {view.hasCredentials ? t("whatsapp.business.edit") : t("whatsapp.business.set")}
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
