import { useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, MessageCircleOff } from "lucide-react";
import { toast } from "sonner";
import { WHATSAPP_RISK_VERSION, type WhatsappQrResponse } from "@eyadex/contracts/whatsapp";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useApi } from "@/shared/api/api-provider";
import { errorCodeOf, isWhatsappUnavailable } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { can } from "@/shared/permissions/can";
import { usePersona, useSession } from "@/shared/persona/persona-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { SectionHeader } from "@/shared/shell/section-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { ClinicSettingsGuard } from "./clinic-settings-guard";
import { WhatsappBusinessCard } from "./whatsapp-business-card";
import { WhatsappCoexistenceDialog } from "./whatsapp-coexistence-dialog";
import { WhatsappQrCard } from "./whatsapp-qr-card";
import { WhatsappQrDialog } from "./whatsapp-qr-dialog";
import { useRefreshWhatsapp, useWhatsappChannel } from "./whatsapp-queries";
import { WhatsappStatusCard } from "./whatsapp-status-card";

export function WhatsappSettingsContent() {
  const { t } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const { session } = useSession();
  const query = useWhatsappChannel();
  const refresh = useRefreshWhatsapp();
  const editable = can(session?.permissions ?? [], "update", "clinic_settings");
  const [qrStart, setQrStart] = useState<WhatsappQrResponse | null>(null);
  const [editingBusiness, setEditingBusiness] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const closeQr = useCallback(() => setQrStart(null), []);

  const onError = (e: unknown) => {
    if (isWhatsappUnavailable(e)) setUnavailable(true);
    else toast.error(t(`errors.${errorCodeOf(e)}`));
  };
  const connect = useMutation({
    mutationFn: () =>
      query.data?.transport === "evolution" && query.data.status === "pending"
        ? api.whatsapp.qr(persona)
        : api.whatsapp.connect(persona, { acceptRisk: true, riskVersion: WHATSAPP_RISK_VERSION }),
    onSuccess: (qr) => {
      refresh();
      if (qr.status === "pending") setQrStart(qr);
    },
    onError,
  });
  const disconnect = useMutation({
    mutationFn: () => api.whatsapp.disconnect(persona),
    onSuccess: () => {
      refresh();
      toast.success(t("whatsapp.disconnected"));
    },
    onError,
    onSettled: () => setConfirmDisconnect(false),
  });

  const view = query.data;
  const live = view && view.status !== "disconnected" ? view.transport : null;
  return (
    <div>
      <SectionHeader title={t("whatsapp.title")} subtitle={t("whatsapp.subtitle")} />
      {query.isLoading ? (
        <LoadingBlock />
      ) : unavailable || (query.error && isWhatsappUnavailable(query.error)) ? (
        <StatusPanel
          icon={MessageCircleOff}
          title={t("whatsapp.unavailableTitle")}
          body={t("whatsapp.unavailableBody")}
        />
      ) : !view ? (
        <StatusPanel icon={AlertTriangle} title={t("clinicSettings.loadError")} body="" />
      ) : (
        <div className="flex max-w-4xl flex-col gap-4">
          {!editable && (
            <p className="text-sm text-muted-foreground">{t("clinicSettings.readOnlyNote")}</p>
          )}
          <WhatsappStatusCard
            view={view}
            editable={editable}
            onDisconnect={() => setConfirmDisconnect(true)}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <WhatsappQrCard
              view={view}
              editable={editable}
              blocked={live === "coexistence"}
              busy={connect.isPending}
              onConnect={() => connect.mutate()}
            />
            <WhatsappBusinessCard
              view={view}
              editable={editable}
              blocked={live === "evolution"}
              onEdit={() => setEditingBusiness(true)}
            />
          </div>
          <WhatsappCoexistenceDialog
            view={view}
            open={editingBusiness}
            onClose={() => setEditingBusiness(false)}
          />
        </div>
      )}
      <WhatsappQrDialog start={qrStart} onClose={closeQr} />
      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader className="text-start">
            <AlertDialogTitle>{t("whatsapp.disconnectTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("whatsapp.disconnectBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:space-x-0">
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>
              {t("whatsapp.disconnect")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** `/clinic/settings/whatsapp`. */
export function WhatsappSettingsPage() {
  return (
    <ClinicSettingsGuard active="whatsapp">
      <WhatsappSettingsContent />
    </ClinicSettingsGuard>
  );
}
