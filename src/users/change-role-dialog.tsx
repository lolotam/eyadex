import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { changeRoleInputSchema, type ChangeRoleInput, type MembershipUserView } from "@contracts/users";
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
import { SelectField } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { userErrorMessage } from "./user-error-message";
import { useRefreshUsers, useRoleOptions } from "./user-queries";

export function ChangeRoleDialog({
  user,
  onClose,
}: {
  user: MembershipUserView | null;
  onClose: () => void;
}) {
  const api = useApi();
  const { persona } = usePersona();
  const { t, pick } = useI18n();
  const refresh = useRefreshUsers();
  const roles = useRoleOptions();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<ChangeRoleInput>({
    resolver: zodResolver(changeRoleInputSchema),
    defaultValues: { roleId: "" },
  });

  useEffect(() => {
    if (user) {
      form.reset({ roleId: user.roleId });
      setServerError(null);
    }
  }, [user, form]);

  const mutation = useMutation({
    mutationFn: (input: ChangeRoleInput) =>
      api.users.changeRole(persona, user?.id ?? "", input),
    onSuccess: () => {
      refresh();
      toast.success(t("users.roleChanged"));
      onClose();
    },
    onError: (error) => setServerError(userErrorMessage(t, error)),
  });

  const options = (roles.data ?? [])
    .filter((r) => r.isActive || r.id === user?.roleId)
    .map((r) => ({ value: r.id, label: pick(r.nameAr, r.nameEn) }));

  return (
    <Dialog open={Boolean(user)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>{t("users.changeRoleTitle")}</DialogTitle>
          <DialogDescription>
            {t("users.changeRoleSubtitle", { name: user?.fullName ?? "" })}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            className="flex flex-col gap-4"
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          >
            <SelectField
              control={form.control}
              name="roleId"
              label={t("users.fields.role")}
              options={options}
            />
            {serverError && (
              <p role="alert" className="text-sm text-destructive">
                {serverError}
              </p>
            )}
            <DialogFooter className="gap-2 sm:space-x-0">
              <Button type="button" variant="outline" onClick={onClose}>
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
