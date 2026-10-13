import { Check, CheckCheck } from "lucide-react";
import type { PatientNotification } from "@eyadex/contracts/notifications";
import { useI18n } from "@/shared/i18n/i18n-provider";

/** A sent WhatsApp row's furthest step (sent → delivered → read), with its time (spec §7.2). */
export function WhatsappReceipt({
  item,
  format,
}: {
  item: PatientNotification;
  format: (iso: string) => string;
}) {
  const { t } = useI18n();
  if (item.channel !== "whatsapp" || item.status !== "sent") return null;
  const step = item.readAt
    ? { at: item.readAt, label: t("messageHistory.receipt.read"), Icon: CheckCheck, read: true }
    : item.deliveredAt
      ? {
          at: item.deliveredAt,
          label: t("messageHistory.receipt.delivered"),
          Icon: CheckCheck,
          read: false,
        }
      : item.sentAt
        ? { at: item.sentAt, label: t("messageHistory.status.sent"), Icon: Check, read: false }
        : null;
  if (!step) return null;
  const { Icon } = step;
  return (
    <span
      data-testid="whatsapp-receipt"
      className={`flex items-center gap-1.5 text-xs ${step.read ? "text-primary" : "text-muted-foreground"}`}
    >
      <Icon
        className="size-3 shrink-0"
        aria-hidden
        data-icon={step.read || item.deliveredAt ? "check-check" : "check"}
      />
      {`${step.label} · ${format(step.at)}`}
    </span>
  );
}
