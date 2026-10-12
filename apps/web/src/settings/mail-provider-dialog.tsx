import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  mailProviderRequestSchema,
  SMTP_PORTS,
  type MailProviderKind,
  type MailProviderView,
} from "@eyadex/contracts/mail-provider";
import type { MailProviderSlot } from "@eyadex/contracts/notifications";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApi } from "@/shared/api/api-provider";
import { errorCodeOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { useRefreshMailProviders } from "./notification-queries";

type Draft = {
  kind: MailProviderKind;
  apiKey: string;
  host: string;
  port: string;
  user: string;
  password: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
};

/** Secrets always start empty: a stored key or password is never shown (write-only, ADR-0014). */
function draftOf(current: MailProviderView | null): Draft {
  return {
    kind: current?.kind ?? "resend",
    apiKey: "",
    host: current?.smtpHost ?? "",
    port: String(current?.smtpPort ?? 587),
    user: current?.smtpUser ?? "",
    password: "",
    fromName: current?.fromName ?? "",
    fromEmail: current?.fromEmail ?? "",
    replyTo: current?.replyTo ?? "",
  };
}

export function toRequest(d: Draft) {
  const sender = {
    fromName: d.fromName,
    fromEmail: d.fromEmail,
    ...(d.replyTo.trim() ? { replyTo: d.replyTo } : {}),
  };
  return d.kind === "resend"
    ? { kind: "resend" as const, apiKey: d.apiKey, ...sender }
    : {
        kind: "smtp" as const,
        host: d.host,
        port: Number(d.port),
        user: d.user,
        password: d.password,
        ...sender,
      };
}

type Props = {
  slot: MailProviderSlot | null;
  current: MailProviderView | null;
  onClose: () => void;
};

export function MailProviderDialog({ slot, current, onClose }: Props) {
  const { t, tDynamic } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const refresh = useRefreshMailProviders();
  const [draft, setDraft] = useState(() => draftOf(current));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const key = useRef(crypto.randomUUID());
  const currentRef = useRef(current);
  currentRef.current = current;
  useEffect(() => {
    if (!slot) return;
    setDraft(draftOf(currentRef.current));
    setErrors({});
    key.current = crypto.randomUUID();
  }, [slot]);

  const mutation = useMutation({
    mutationFn: (input: ReturnType<typeof toRequest>) =>
      api.notifications.setMailProvider(persona, slot ?? "primary", input, key.current),
    onSuccess: () => {
      refresh();
      toast.success(t("mailProviders.saved"));
      onClose();
    },
    onError: (e) => toast.error(t(`errors.${errorCodeOf(e)}`)),
  });

  const submit = () => {
    const parsed = mailProviderRequestSchema.safeParse(toRequest(draft));
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "");
        next[field] ??= issue.message.startsWith("validation.")
          ? issue.message
          : "validation.required";
      }
      setErrors(next);
      return;
    }
    setErrors({});
    mutation.mutate(toRequest(draft));
  };

  const field = (name: keyof Draft, opts: { type?: string; ltr?: boolean } = {}) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`mp-${name}`}>{t(`mailProviders.fields.${name as "apiKey"}`)}</Label>
      <Input
        id={`mp-${name}`}
        type={opts.type ?? "text"}
        autoComplete={opts.type === "password" ? "new-password" : "off"}
        {...(opts.ltr ? { dir: "ltr" as const } : {})}
        value={draft[name]}
        onChange={(e) => setDraft((d) => ({ ...d, [name]: e.target.value }))}
      />
      {errors[name] && (
        <p className="text-[0.8rem] font-medium text-destructive">{tDynamic(errors[name])}</p>
      )}
    </div>
  );

  return (
    <Dialog open={slot !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg sm:max-w-lg">
        <DialogHeader className="text-start">
          <DialogTitle>{slot ? t(`mailProviders.${slot}`) : ""}</DialogTitle>
          <DialogDescription>{t("mailProviders.sheetHint")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <Tabs
            value={draft.kind}
            onValueChange={(kind) => setDraft((d) => ({ ...d, kind: kind as MailProviderKind }))}
          >
            <TabsList aria-label={t("mailProviders.kind")}>
              <TabsTrigger value="resend">{t("mailProviders.kinds.resend")}</TabsTrigger>
              <TabsTrigger value="smtp">{t("mailProviders.kinds.smtp")}</TabsTrigger>
            </TabsList>
          </Tabs>
          {draft.kind === "resend" ? (
            field("apiKey", { type: "password", ltr: true })
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                {field("host", { ltr: true })}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="mp-port">{t("mailProviders.fields.port")}</Label>
                  <Select
                    value={draft.port}
                    onValueChange={(port) => setDraft((d) => ({ ...d, port }))}
                  >
                    <SelectTrigger id="mp-port">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SMTP_PORTS.map((p) => (
                        <SelectItem key={p} value={String(p)}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {field("user", { ltr: true })}
              {field("password", { type: "password", ltr: true })}
            </>
          )}
          {field("fromName")}
          {field("fromEmail", { type: "email", ltr: true })}
          {field("replyTo", { type: "email", ltr: true })}
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
