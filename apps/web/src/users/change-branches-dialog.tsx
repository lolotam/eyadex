import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  changeBranchesInputSchema,
  type ChangeBranchesInput,
  type MembershipUserView,
} from "@eyadex/contracts/users";
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
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { BranchAccessField } from "./branch-access-field";
import { userErrorMessage } from "./user-error-message";
import { useBranchOptions, useRefreshUsers } from "./user-queries";

export function ChangeBranchesDialog({
  user,
  onClose,
}: {
  user: MembershipUserView | null;
  onClose: () => void;
}) {
  const api = useApi();
  const { persona } = usePersona();
  const { t } = useI18n();
  const refresh = useRefreshUsers();
  const branches = useBranchOptions();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<ChangeBranchesInput>({
    resolver: zodResolver(changeBranchesInputSchema),
    defaultValues: { allBranches: true, branchIds: [] },
  });

  useEffect(() => {
    if (!user) return;
    const activeIds = new Set((branches.data ?? []).filter((b) => b.isActive).map((b) => b.id));
    form.reset({
      allBranches: user.allBranches,
      branchIds: user.branchIds.filter((id) => activeIds.has(id)),
    });
    setServerError(null);
  }, [user, branches.data, form]);

  const mutation = useMutation({
    mutationFn: (input: ChangeBranchesInput) =>
      api.users.changeBranches(persona, user?.id ?? "", input),
    onSuccess: () => {
      refresh();
      toast.success(t("users.branchesChanged"));
      onClose();
    },
    onError: (error) => setServerError(userErrorMessage(t, error)),
  });

  return (
    <Dialog open={Boolean(user)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>{t("users.changeBranchesTitle")}</DialogTitle>
          <DialogDescription>
            {t("users.changeBranchesSubtitle", { name: user?.fullName ?? "" })}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            className="flex flex-col gap-4"
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          >
            <BranchAccessField control={form.control} branches={branches.data ?? []} />
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
