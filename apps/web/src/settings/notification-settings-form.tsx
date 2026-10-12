import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { toast } from "sonner";
import { NOTIFICATION_KINDS, type NotificationSettings } from "@eyadex/contracts/notifications";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useApi } from "@/shared/api/api-provider";
import { errorCodeOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { can } from "@/shared/permissions/can";
import { usePersona, useSession } from "@/shared/persona/persona-provider";

function SwitchRow({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b px-4 py-3 last:border-b-0">
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

/** N-1: one channel switch, then one per message kind; the kinds keep their values while email is off. */
export function NotificationSettingsForm({ settings }: { settings: NotificationSettings }) {
  const { t } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const { session } = useSession();
  const queryClient = useQueryClient();
  const editable = can(session?.permissions ?? [], "update", "clinic_settings");
  const [value, setValue] = useState(settings);
  const mutation = useMutation({
    mutationFn: (input: NotificationSettings) => api.notifications.updateSettings(persona, input),
    onSuccess: (saved) => {
      setValue(saved);
      void queryClient.invalidateQueries({ queryKey: ["clinic", "notification-settings"] });
      toast.success(t("notificationSettings.saved"));
    },
    onError: (e) => toast.error(t(`errors.${errorCodeOf(e)}`)),
  });
  return (
    <Card className="max-w-2xl">
      <CardContent className="flex flex-col gap-4 pt-6">
        {!editable && (
          <p className="text-sm text-muted-foreground">{t("clinicSettings.readOnlyNote")}</p>
        )}
        <div className="rounded-lg border">
          <SwitchRow
            id="notify-email"
            label={t("notificationSettings.emailEnabled")}
            hint={t("notificationSettings.emailEnabledHint")}
            checked={value.emailEnabled}
            disabled={!editable}
            onChange={(emailEnabled) => setValue((v) => ({ ...v, emailEnabled }))}
          />
        </div>
        <div className="rounded-lg border">
          {NOTIFICATION_KINDS.map((kind) => (
            <SwitchRow
              key={kind}
              id={`notify-${kind}`}
              label={t(`notificationSettings.kinds.${kind}`)}
              hint={t(`notificationSettings.hints.${kind}`)}
              checked={value.messages[kind]}
              disabled={!editable || !value.emailEnabled}
              onChange={(on) =>
                setValue((v) => ({ ...v, messages: { ...v.messages, [kind]: on } }))
              }
            />
          ))}
        </div>
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          {t("notificationSettings.note")}
        </p>
        {editable && (
          <div className="flex justify-end">
            <Button disabled={mutation.isPending} onClick={() => mutation.mutate(value)}>
              {t("common.save")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
