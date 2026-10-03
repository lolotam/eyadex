import { Copy, ExternalLink, MailCheck } from "lucide-react";
import { toast } from "sonner";
import type { FirstAdminInviteLink } from "@eyadex/contracts/clinics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/shared/i18n/i18n-provider";

/** Shows the simulated first-admin invitation link; in production it is emailed instead. */
export function FirstAdminLinkPanel({ invite }: { invite: FirstAdminInviteLink }) {
  const { t, formatDate } = useI18n();
  const url =
    typeof window === "undefined"
      ? `/invite/${invite.token}`
      : `${window.location.origin}/invite/${invite.token}`;
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex items-start gap-3">
        <MailCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <p className="font-medium">
            {t("clinics.firstAdmin.linkTitle", { email: invite.email })}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("clinics.firstAdmin.expires", { date: formatDate(invite.expiresAt) })}
          </p>
        </div>
      </div>
      <Input readOnly value={url} dir="ltr" aria-label={t("clinics.firstAdmin.linkLabel")} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            void navigator.clipboard
              ?.writeText(url)
              .then(() => toast.success(t("clinics.firstAdmin.copied")))
              .catch(() => toast.message(url))
          }
        >
          <Copy aria-hidden />
          {t("clinics.firstAdmin.copy")}
        </Button>
        <Button asChild variant="outline">
          <a href={url} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden />
            {t("clinics.firstAdmin.open")}
          </a>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("clinics.firstAdmin.demoNote")}</p>
    </div>
  );
}
