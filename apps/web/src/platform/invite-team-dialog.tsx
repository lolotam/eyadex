import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  invitePlatformAccountInputSchema,
  type InvitePlatformAccountInput,
} from "@eyadex/contracts/platform";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { useApi } from "@/shared/api/api-provider";
import { errorCodeOf } from "@/shared/api/api-error";
import { TextField } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { useRefreshPlatform } from "./platform-queries";

const EMPTY: InvitePlatformAccountInput = { fullName: "", email: "" };

export function InviteTeamDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const refresh = useRefreshPlatform();
  const form = useForm<InvitePlatformAccountInput>({
    resolver: zodResolver(invitePlatformAccountInputSchema),
    defaultValues: EMPTY,
  });
  // One key per opened dialog: a retry after a lost answer replays it instead of inviting twice.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (!open) return;
    form.reset(EMPTY);
    setIdempotencyKey(crypto.randomUUID());
  }, [open, form]);
  const mutation = useMutation({
    mutationFn: (input: InvitePlatformAccountInput) =>
      api.platformTeam.invite(persona, input, idempotencyKey),
    onSuccess: () => {
      refresh();
      toast.success(t("team.invited"));
      onOpenChange(false);
    },
    onError: (e) => toast.error(t(`errors.${errorCodeOf(e)}`)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="text-start">
          <DialogTitle>{t("team.inviteTitle")}</DialogTitle>
          <DialogDescription>{t("team.inviteBody")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            className="flex flex-col gap-4"
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
          >
            <TextField control={form.control} name="fullName" label={t("team.fullName")} />
            <TextField
              control={form.control}
              name="email"
              type="email"
              dir="ltr"
              label={t("team.email")}
            />
            <DialogFooter className="gap-2 sm:space-x-0">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {t("team.invite")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
