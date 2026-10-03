import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { inviteUserInputSchema, type InviteUserInput } from "@contracts/users";
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
import { SelectField, TextField } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { BranchAccessField } from "./branch-access-field";
import { userErrorMessage } from "./user-error-message";
import { useBranchOptions, useRefreshUsers, useRoleOptions } from "./user-queries";

const EMPTY: InviteUserInput = {
  fullName: "",
  email: "",
  roleId: "",
  allBranches: true,
  branchIds: [],
};

export function InviteUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const api = useApi();
  const { persona } = usePersona();
  const { t, pick } = useI18n();
  const refresh = useRefreshUsers();
  const roles = useRoleOptions();
  const branches = useBranchOptions();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<InviteUserInput>({
    resolver: zodResolver(inviteUserInputSchema),
    defaultValues: EMPTY,
  });

  // One key per opening of the dialog: a retry of the same submission replays the first result.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (open) {
      form.reset(EMPTY);
      setServerError(null);
      setIdempotencyKey(crypto.randomUUID());
    }
  }, [open, form]);

  const mutation = useMutation({
    mutationFn: (input: InviteUserInput) => api.invitations.invite(persona, input, idempotencyKey),
    onSuccess: () => {
      refresh();
      toast.success(t("users.invited"));
      onOpenChange(false);
    },
    onError: (error) => setServerError(userErrorMessage(t, error)),
  });

  const roleOptions = (roles.data ?? [])
    .filter((r) => r.isActive)
    .map((r) => ({ value: r.id, label: pick(r.nameAr, r.nameEn) }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="text-start">
          <DialogTitle>{t("users.inviteTitle")}</DialogTitle>
          <DialogDescription>{t("users.inviteSubtitle")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            className="flex flex-col gap-4"
            onSubmit={form.handleSubmit((values) => {
              setServerError(null);
              mutation.mutate(values);
            })}
          >
            <TextField control={form.control} name="fullName" label={t("users.fields.fullName")} />
            <TextField
              control={form.control}
              name="email"
              type="email"
              dir="ltr"
              label={t("users.fields.email")}
            />
            <SelectField
              control={form.control}
              name="roleId"
              label={t("users.fields.role")}
              options={roleOptions}
            />
            <BranchAccessField control={form.control} branches={branches.data ?? []} />
            {serverError && (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                {serverError}
              </p>
            )}
            <DialogFooter className="gap-2 sm:space-x-0">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {t("users.invite")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
