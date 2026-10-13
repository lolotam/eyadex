import { useEffect } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { WhatsappQrResponse } from "@eyadex/contracts/whatsapp";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useApi } from "@/shared/api/api-provider";
import { errorCodeOf, isWhatsappUnavailable } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { useQrPolling } from "./use-qr-polling";
import { useRefreshWhatsapp } from "./whatsapp-queries";

const STEPS = ["open", "devices", "link", "scan"] as const;

/** The QR to scan, refreshed every few seconds until the phone links (or the code expires). */
export function WhatsappQrDialog({
  start,
  onClose,
}: {
  start: WhatsappQrResponse | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const refreshChannel = useRefreshWhatsapp();
  const open = start !== null;
  const { qr, expired, refresh } = useQrPolling(open, start, () => api.whatsapp.qr(persona));

  const connected = open && qr?.status === "connected";
  useEffect(() => {
    if (!connected) return;
    toast.success(t("whatsapp.qr.connected"));
    refreshChannel();
    onClose();
  }, [connected, t, refreshChannel, onClose]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          refreshChannel();
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>{t("whatsapp.qr.dialogTitle")}</DialogTitle>
          <DialogDescription className="sr-only">{t("whatsapp.qr.body")}</DialogDescription>
        </DialogHeader>
        <ol className="flex list-decimal flex-col gap-1 ps-5 text-sm">
          {STEPS.map((step) => (
            <li key={step}>{t(`whatsapp.qr.steps.${step}`)}</li>
          ))}
        </ol>
        <div className="flex flex-col items-center gap-3 py-2">
          {qr?.qrDataUrl && !expired ? (
            <img
              src={qr.qrDataUrl}
              alt={t("whatsapp.qr.image")}
              className="size-56 rounded-md border bg-card [image-rendering:pixelated]"
            />
          ) : null}
          {expired ? (
            <>
              <p className="text-sm text-muted-foreground">{t("whatsapp.qr.expired")}</p>
              <Button
                variant="outline"
                onClick={() =>
                  void refresh().catch((e: unknown) =>
                    toast.error(
                      isWhatsappUnavailable(e)
                        ? t("whatsapp.unavailableTitle")
                        : t(`errors.${errorCodeOf(e)}`),
                    ),
                  )
                }
              >
                <RefreshCw className="size-4" />
                {t("whatsapp.qr.refresh")}
              </Button>
            </>
          ) : (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {qr?.status === "pending" && !qr.qrDataUrl
                ? t("whatsapp.qr.preparing")
                : t("whatsapp.qr.waiting")}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
