import {
  AlertCircle,
  CircleCheck,
  CircleSlash,
  Clock,
  Mail,
  MailX,
  MessageCircle,
} from "lucide-react";
import type { NotificationStatus, PatientNotification } from "@eyadex/contracts/notifications";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useSession } from "@/shared/persona/persona-provider";

const LOOK: Record<
  NotificationStatus,
  { icon: typeof Clock; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  queued: { icon: Clock, variant: "outline" },
  sent: { icon: CircleCheck, variant: "default" },
  skipped: { icon: CircleSlash, variant: "secondary" },
  failed: { icon: AlertCircle, variant: "destructive" },
};

export function NotificationStatusBadge({ status }: { status: NotificationStatus }) {
  const { t } = useI18n();
  const { icon: Icon, variant } = LOOK[status];
  return (
    <Badge variant={variant} className="gap-1.5 whitespace-nowrap">
      <Icon className="size-3" />
      {t(`messageHistory.status.${status}`)}
    </Badge>
  );
}

/** One row's words: the kind, the channel, then why it was skipped or which sender delivered it, then the time. */
export function MessageHistoryRow({ item }: { item: PatientNotification }) {
  const { t, lang } = useI18n();
  const { session } = useSession();
  const time = new Intl.DateTimeFormat(lang === "ar" ? "ar-KW" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: session?.clinic?.timezone ?? "Asia/Kuwait",
  }).format(new Date(item.sentAt ?? item.createdAt));
  const detail =
    item.status === "skipped" && item.skipReason
      ? t(`messageHistory.skip.${item.skipReason}`)
      : item.route
        ? t(`messageHistory.route.${item.route}`)
        : null;
  const ChannelIcon = item.channel === "whatsapp" ? MessageCircle : Mail;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 last:border-b-0">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{t(`notificationSettings.kinds.${item.kind}`)}</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ChannelIcon className="size-3 shrink-0" aria-hidden />
          {[t(`messageHistory.channel.${item.channel}`), detail, time].filter(Boolean).join(" · ")}
        </span>
      </div>
      <NotificationStatusBadge status={item.status} />
    </li>
  );
}

export function MessageHistoryList({
  items,
  emptyText,
}: {
  items: readonly PatientNotification[];
  emptyText: string;
}) {
  if (items.length === 0)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <MailX className="size-4" />
        {emptyText}
      </p>
    );
  return (
    <ul className="rounded-lg border">
      {items.map((item) => (
        <MessageHistoryRow key={item.id} item={item} />
      ))}
    </ul>
  );
}
