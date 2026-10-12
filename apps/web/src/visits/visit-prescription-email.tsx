import { Mail } from "lucide-react";
import { MessageHistoryRow } from "@/shared/messages/message-history-list";
import { useMessageHistory } from "@/shared/messages/use-message-history";
import { useI18n } from "@/shared/i18n/i18n-provider";

/** Spec §6: on a signed visit, one line saying whether the prescription email was sent, skipped or failed. */
export function VisitPrescriptionEmail({ visitId }: { visitId: string }) {
  const { t } = useI18n();
  const query = useMessageHistory("visit", visitId);
  const item = query.data?.items.find((i) => i.kind === "prescription");
  if (query.isLoading) return null;
  return (
    <section className="rounded-lg border bg-card">
      <h3 className="flex items-center gap-2 border-b px-3 py-2 text-sm font-semibold">
        <Mail className="size-4" />
        {t("messageHistory.prescriptionTitle")}
      </h3>
      {item ? (
        <ul>
          <MessageHistoryRow item={item} />
        </ul>
      ) : (
        <p className="px-3 py-2 text-sm text-muted-foreground">
          {query.data ? t("messageHistory.prescriptionNone") : t("messageHistory.loadError")}
        </p>
      )}
    </section>
  );
}
