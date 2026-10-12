import { useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, CircleDashed, MailX, Send } from "lucide-react";
import { toast } from "sonner";
import type { MailProviderView } from "@eyadex/contracts/mail-provider";
import type { MailProviderSlot } from "@eyadex/contracts/notifications";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useApi } from "@/shared/api/api-provider";
import { errorCodeOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona, useSession } from "@/shared/persona/persona-provider";
import { useRefreshMailProviders } from "./notification-queries";

/** How long to wait before looking for the worker's report on a test send. */
export const TEST_REFETCH_MS = 3000;

export function ProviderStatusBadge({ provider }: { provider: MailProviderView }) {
  const { t } = useI18n();
  if (provider.degradedAt)
    return (
      <Badge variant="destructive" className="gap-1.5">
        <CircleAlert className="size-3" />
        {t("mailProviders.status.degraded")}
      </Badge>
    );
  if (provider.verifiedAt)
    return (
      <Badge className="gap-1.5">
        <CircleCheck className="size-3" />
        {t("mailProviders.status.verified")}
      </Badge>
    );
  return (
    <Badge variant="secondary" className="gap-1.5">
      <CircleDashed className="size-3" />
      {t("mailProviders.status.unverified")}
    </Badge>
  );
}

type Props = {
  slot: MailProviderSlot;
  provider: MailProviderView | null;
  editable: boolean;
  /** Why setting is refused (a fallback with no primary), or null. */
  setBlocked: string | null;
  /** Why removing is refused (the primary while a fallback exists), or null. */
  removeBlocked: string | null;
  onEdit: () => void;
  onRemove: () => void;
};

export function MailProviderCard(props: Props) {
  const { slot, provider, editable, setBlocked, removeBlocked } = props;
  const { t, lang } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const { session } = useSession();
  const refresh = useRefreshMailProviders();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const test = useMutation({
    mutationFn: () => api.notifications.testMailProvider(persona, slot, crypto.randomUUID()),
    onSuccess: () => {
      toast.success(t("mailProviders.testSent"));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(refresh, TEST_REFETCH_MS);
    },
    onError: (e) => toast.error(t(`errors.${errorCodeOf(e)}`)),
  });
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(lang === "ar" ? "ar-KW" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: session?.clinic?.timezone ?? "Asia/Kuwait",
    }).format(new Date(iso));

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t(`mailProviders.${slot}`)}</h3>
          {provider && <ProviderStatusBadge provider={provider} />}
        </div>
        {provider ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <Row label={t("mailProviders.kind")} value={t(`mailProviders.kinds.${provider.kind}`)} />
            <Row label={t("mailProviders.from")} value={`${provider.fromName} <${provider.fromEmail}>`} ltr />
            <Row label={t("mailProviders.replyTo")} value={provider.replyTo ?? "—"} ltr />
            {provider.kind === "smtp" && (
              <>
                <Row
                  label={t("mailProviders.server")}
                  value={`${provider.smtpHost ?? ""}:${provider.smtpPort ?? ""}`}
                  ltr
                />
                <Row label={t("mailProviders.user")} value={provider.smtpUser ?? "—"} ltr />
              </>
            )}
          </dl>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <MailX className="size-4" />
            {t("mailProviders.notSet")}
          </p>
        )}
        {provider?.lastError && (
          <p className="text-xs text-destructive">
            {t("mailProviders.lastError", { error: provider.lastError })}
            {provider.degradedAt && ` · ${t("mailProviders.degradedAt", { time: fmt(provider.degradedAt) })}`}
          </p>
        )}
        {provider?.verifiedAt && !provider.degradedAt && (
          <p className="text-xs text-muted-foreground">
            {t("mailProviders.verifiedAt", { time: fmt(provider.verifiedAt) })}
          </p>
        )}
        {editable && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={setBlocked !== null} onClick={props.onEdit}>
              {t(provider ? "mailProviders.replace" : "mailProviders.set")}
            </Button>
            {provider && (
              <>
                <Button size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
                  <Send className="size-4" />
                  {t("mailProviders.test")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={removeBlocked !== null}
                  onClick={props.onRemove}
                >
                  {t("mailProviders.remove")}
                </Button>
              </>
            )}
          </div>
        )}
        {editable && (setBlocked ?? (provider ? removeBlocked : null)) && (
          <p className="text-xs text-muted-foreground">{setBlocked ?? removeBlocked}</p>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-all font-medium">
        <span className="inline-block" {...(ltr ? { dir: "ltr" as const } : {})}>
          {value}
        </span>
      </dd>
    </div>
  );
}
