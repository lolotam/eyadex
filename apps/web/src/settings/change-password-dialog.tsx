import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { changePasswordInputSchema, type ChangePasswordInput } from "@eyadex/contracts/users";
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

const EMPTY: ChangePasswordInput = { currentPassword: "", newPassword: "", confirmPassword: "" };

/** Story 64 (ADR-0020): Better Auth changes the password; the account's other sessions end. */
export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordInputSchema),
    defaultValues: EMPTY,
  });
  useEffect(() => {
    if (open) form.reset(EMPTY);
  }, [open, form]);
  const mutation = useMutation({
    mutationFn: (input: ChangePasswordInput) => api.account.changePassword(persona, input),
    onSuccess: () => {
      toast.success(t("account.passwordSaved"));
      onOpenChange(false);
    },
    onError: (e) => {
      const code = errorCodeOf(e);
      toast.error(t(code === "invalid_credentials" ? "account.passwordWrong" : `errors.${code}`));
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>{t("account.passwordButton")}</DialogTitle>
          <DialogDescription>{t("account.passwordDialogBody")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            className="flex flex-col gap-4"
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
          >
            <TextField
              control={form.control}
              name="currentPassword"
              type="password"
              label={t("account.currentPassword")}
            />
            <TextField
              control={form.control}
              name="newPassword"
              type="password"
              label={t("account.newPassword")}
            />
            <TextField
              control={form.control}
              name="confirmPassword"
              type="password"
              label={t("account.confirmPassword")}
            />
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
