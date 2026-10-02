import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { branchInputSchema, type Branch, type BranchInput } from "@contracts/organization";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useApi } from "@/shared/api/api-provider";
import { errorCodeOf } from "@/shared/api/api-error";
import { TextField } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { branchKeys } from "./branch-queries";

const EMPTY: BranchInput = { nameAr: "", nameEn: "", address: "", phone: "" };

export function BranchFormSheet({ open, branch, onOpenChange }: { open: boolean; branch: Branch | null; onOpenChange: (open: boolean) => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { persona } = usePersona();
  const { t } = useI18n();
  const form = useForm<BranchInput>({ resolver: zodResolver(branchInputSchema), defaultValues: EMPTY });

  useEffect(() => {
    form.reset(branch ? { nameAr: branch.nameAr, nameEn: branch.nameEn, address: branch.address ?? "", phone: branch.phone ?? "" } : EMPTY);
  }, [branch, form, open]);

  const mutation = useMutation({
    mutationFn: (input: BranchInput) => branch ? api.branches.update(persona, branch.id, input) : api.branches.create(persona, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: branchKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["platform", "clinics"] });
      toast.success(t(branch ? "branches.updated" : "branches.created"));
      onOpenChange(false);
    },
    onError: (error) => {
      const code = errorCodeOf(error);
      toast.error(t(`errors.${code}`));
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>{t(branch ? "branches.editTitle" : "branches.createTitle")}</DialogTitle>
          <DialogDescription>{t(branch ? "branches.editSubtitle" : "branches.createSubtitle")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form id="branch-form" className="flex flex-1 flex-col gap-5 overflow-y-auto py-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
            <TextField control={form.control} name="nameAr" label={t("branches.fields.nameAr")} dir="rtl" />
            <TextField control={form.control} name="nameEn" label={t("branches.fields.nameEn")} dir="ltr" />
            <TextField control={form.control} name="address" label={t("branches.fields.address")} />
            <TextField control={form.control} name="phone" label={t("branches.fields.phone")} type="tel" dir="ltr" />
          </form>
        </Form>
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button type="submit" form="branch-form" disabled={mutation.isPending}>{branch ? t("common.save") : t("common.create")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}