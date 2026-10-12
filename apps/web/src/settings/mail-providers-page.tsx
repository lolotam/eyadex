import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Info } from "lucide-react";
import { toast } from "sonner";
import type { MailProviderSlot } from "@eyadex/contracts/notifications";
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
import { errorCodeOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { can } from "@/shared/permissions/can";
import { usePersona, useSession } from "@/shared/persona/persona-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { SectionHeader } from "@/shared/shell/section-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { ClinicSettingsGuard } from "./clinic-settings-guard";
import { MailProviderCard } from "./mail-provider-card";
import { MailProviderDialog } from "./mail-provider-dialog";
import { useMailProviders, useRefreshMailProviders } from "./notification-queries";

export function MailProvidersContent() {
  const { t } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const { session } = useSession();
  const query = useMailProviders();
  const refresh = useRefreshMailProviders();
  const editable = can(session?.permissions ?? [], "update", "clinic_settings");
  const [editing, setEditing] = useState<MailProviderSlot | null>(null);
  const [removing, setRemoving] = useState<MailProviderSlot | null>(null);
  const remove = useMutation({
    mutationFn: (slot: MailProviderSlot) => api.notifications.removeMailProvider(persona, slot),
    onSuccess: () => {
      refresh();
      toast.success(t("mailProviders.removed"));
    },
    onError: (e) => toast.error(t(`errors.${errorCodeOf(e)}`)),
    onSettled: () => setRemoving(null),
  });

  const data = query.data;
  return (
    <div>
      <SectionHeader title={t("mailProviders.title")} subtitle={t("mailProviders.subtitle")} />
      {query.isLoading ? (
        <LoadingBlock />
      ) : !data ? (
        <StatusPanel icon={AlertTriangle} title={t("clinicSettings.loadError")} body="" />
      ) : (
        <div className="flex max-w-3xl flex-col gap-4">
          {!editable && (
            <p className="text-sm text-muted-foreground">{t("clinicSettings.readOnlyNote")}</p>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <MailProviderCard
              slot="primary"
              provider={data.primary}
              editable={editable}
              setBlocked={null}
              removeBlocked={data.fallback ? t("mailProviders.primaryHasFallback") : null}
              onEdit={() => setEditing("primary")}
              onRemove={() => setRemoving("primary")}
            />
            <MailProviderCard
              slot="fallback"
              provider={data.fallback}
              editable={editable}
              setBlocked={data.primary ? null : t("mailProviders.fallbackNeedsPrimary")}
              removeBlocked={null}
              onEdit={() => setEditing("fallback")}
              onRemove={() => setRemoving("fallback")}
            />
          </div>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" />
            {t("mailProviders.help")}
          </p>
        </div>
      )}
      <MailProviderDialog
        slot={editing}
        current={editing && data ? data[editing] : null}
        onClose={() => setEditing(null)}
      />
      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader className="text-start">
            <AlertDialogTitle>
              {t("mailProviders.removeTitle", {
                slot: removing ? t(`mailProviders.${removing}`) : "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("mailProviders.removeBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:space-x-0">
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={() => removing && remove.mutate(removing)}
            >
              {t("mailProviders.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** `/clinic/settings/email`. */
export function MailProvidersPage() {
  return (
    <ClinicSettingsGuard active="email">
      <MailProvidersContent />
    </ClinicSettingsGuard>
  );
}
