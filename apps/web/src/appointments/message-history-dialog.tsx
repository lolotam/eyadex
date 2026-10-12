import { AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMessageHistory } from "@/shared/messages/use-message-history";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { MessageHistoryList } from "@/shared/messages/message-history-list";

function HistoryBody({ appointmentId }: { appointmentId: string }) {
  const { t } = useI18n();
  const query = useMessageHistory("appointment", appointmentId);
  if (query.isLoading) return <LoadingBlock />;
  if (!query.data)
    return (
      <p className="flex items-center gap-2 text-sm text-destructive">
        <AlertCircle className="size-4" />
        {t("messageHistory.loadError")}
      </p>
    );
  return <MessageHistoryList items={query.data.items} emptyText={t("messageHistory.empty")} />;
}

/** The appointment's messages to the patient (spec §6): kind, status, reason or sender, time. */
export function MessageHistoryDialog({
  appointmentId,
  patientName,
  onClose,
}: {
  appointmentId: string | null;
  patientName: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={appointmentId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>{t("messageHistory.title")}</DialogTitle>
          <DialogDescription>{patientName}</DialogDescription>
        </DialogHeader>
        {appointmentId && <HistoryBody appointmentId={appointmentId} />}
      </DialogContent>
    </Dialog>
  );
}
