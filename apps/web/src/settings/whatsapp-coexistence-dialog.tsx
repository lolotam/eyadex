import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { NOTIFICATION_KINDS } from "@eyadex/contracts/notifications";
import {
  whatsappCoexistenceRequestSchema,
  type WhatsappChannelView,
  type WhatsappCoexistenceRequest,
} from "@eyadex/contracts/whatsapp";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApi } from "@/shared/api/api-provider";
import { ApiError, errorCodeOf, isWhatsappUnavailable } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import {
  coexistenceDraftOf,
  toCoexistenceRequest,
  type CoexistenceDraft,
} from "./whatsapp-coexistence-draft";
import { useRefreshWhatsapp } from "./whatsapp-queries";

type Field = "accessToken" | "phoneNumberId" | "businessAccountId";
const APPOINTMENT_PARAMS = ["clinic", "date", "time", "provider", "branch"] as const;
const PRESCRIPTION_PARAMS = ["clinic", "doctor", "medicines"] as const;

export function WhatsappCoexistenceDialog({
  view,
  open,
  onClose,
}: {
  view: WhatsappChannelView;
  open: boolean;
  onClose: () => void;
}) {
  const { t, tDynamic } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const refresh = useRefreshWhatsapp();
  const { register, reset, handleSubmit } = useForm<CoexistenceDraft>({
    defaultValues: coexistenceDraftOf(view),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const tokenStored = view.transport === "coexistence" && view.hasCredentials;
  useEffect(() => {
    if (!open) return;
    reset(coexistenceDraftOf(view));
    setErrors({});
    // Only on opening: a background refetch must not wipe what the admin is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const mutation = useMutation({
    mutationFn: (input: WhatsappCoexistenceRequest) => api.whatsapp.saveCoexistence(persona, input),
    onSuccess: () => {
      refresh();
      toast.success(t("whatsapp.business.saved"));
      onClose();
    },
    onError: (e) => {
      if (isWhatsappUnavailable(e)) {
        toast.error(t("whatsapp.unavailableTitle"));
        return;
      }
      if (e instanceof ApiError && e.details["transport"] === "evolution_linked") {
        setErrors({ transport: "whatsapp.errors.evolution_linked" });
        return;
      }
      if (e instanceof ApiError && e.details["phoneNumberId"] === "number_in_use") {
        setErrors({ phoneNumberId: "whatsapp.errors.number_in_use" });
        return;
      }
      if (e instanceof ApiError && e.details["accessToken"] === "meta_credentials_invalid") {
        setErrors({ accessToken: "whatsapp.errors.meta_credentials_invalid" });
        return;
      }
      if (e instanceof ApiError && e.details["accessToken"] === "required")
        setErrors({ accessToken: "validation.required" });
      toast.error(t(`errors.${errorCodeOf(e)}`));
    },
  });

  const submit = handleSubmit((draft) => {
    const request = toCoexistenceRequest(draft);
    const next: Record<string, string> = {};
    if (!tokenStored && !request.accessToken) next["accessToken"] = "validation.required";
    const parsed = whatsappCoexistenceRequestSchema.safeParse(request);
    if (!parsed.success)
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".");
        next[key] ??= issue.message.startsWith("validation.")
          ? issue.message
          : "validation.required";
      }
    setErrors(next);
    if (Object.keys(next).length === 0 && parsed.success) mutation.mutate(parsed.data);
  });

  const error = (key: string) =>
    errors[key] ? (
      <p className="text-[0.8rem] font-medium text-destructive">{tDynamic(errors[key])}</p>
    ) : null;

  const field = (name: Field, type = "text") => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`wa-${name}`}>{t(`whatsapp.business.fields.${name}`)}</Label>
      <Input
        id={`wa-${name}`}
        type={type}
        dir="ltr"
        autoComplete={type === "password" ? "new-password" : "off"}
        {...register(name)}
      />
      {name === "accessToken" && (
        <p className="text-xs text-muted-foreground">{t("whatsapp.business.tokenHelp")}</p>
      )}
      {name === "accessToken" && tokenStored && (
        <p className="text-xs text-muted-foreground">{t("whatsapp.business.tokenStored")}</p>
      )}
      {error(name)}
    </div>
  );

  const params = (list: readonly string[]) =>
    list.map((p, i) => `{{${i + 1}}} ${tDynamic(`whatsapp.business.params.${p}`)}`).join(" · ");

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg sm:max-w-2xl">
        <DialogHeader className="text-start">
          <DialogTitle>{t("whatsapp.business.title")}</DialogTitle>
          <DialogDescription>{t("whatsapp.business.dialogHint")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          {error("transport")}
          {field("accessToken", "password")}
          <div className="grid gap-4 sm:grid-cols-2">
            {field("phoneNumberId")}
            {field("businessAccountId")}
          </div>
          <h3 className="pt-2 text-sm font-semibold">{t("whatsapp.business.templatesTitle")}</h3>
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <p>{t("whatsapp.business.templatesHelp")}</p>
            <p>
              {t("whatsapp.business.paramsAppointment")} <span>{params(APPOINTMENT_PARAMS)}</span>
            </p>
            <p>
              {t("whatsapp.business.paramsPrescription")} <span>{params(PRESCRIPTION_PARAMS)}</span>
            </p>
          </div>
          <div className="flex flex-col rounded-lg border">
            {NOTIFICATION_KINDS.map((kind) => (
              <fieldset
                key={kind}
                className="grid gap-2 border-b px-3 py-3 last:border-b-0 sm:grid-cols-[1fr_1fr_7rem] sm:items-start"
              >
                <legend className="sr-only">{t(`notificationSettings.kinds.${kind}`)}</legend>
                <span className="text-sm font-medium sm:pt-2" aria-hidden>
                  {t(`notificationSettings.kinds.${kind}`)}
                </span>
                <div className="flex flex-col gap-1">
                  <Input
                    aria-label={`${t(`notificationSettings.kinds.${kind}`)} — ${t("whatsapp.business.templateName")}`}
                    placeholder={t("whatsapp.business.templateName")}
                    dir="ltr"
                    {...register(`templates.${kind}.name`)}
                  />
                  {error(`templates.${kind}.name`)}
                </div>
                <div className="flex flex-col gap-1">
                  <Input
                    aria-label={`${t(`notificationSettings.kinds.${kind}`)} — ${t("whatsapp.business.templateLanguage")}`}
                    placeholder={t("whatsapp.business.templateLanguage")}
                    dir="ltr"
                    {...register(`templates.${kind}.language`)}
                  />
                  {error(`templates.${kind}.language`)}
                </div>
              </fieldset>
            ))}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="button" disabled={mutation.isPending} onClick={submit}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
