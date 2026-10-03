import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Branch } from "@eyadex/contracts/organization";
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
import { usePersona } from "@/shared/persona/persona-provider";
import { branchKeys } from "./branch-queries";

export function BranchStatusDialog({
  branch,
  onClose,
}: {
  branch: Branch | null;
  onClose: () => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { persona } = usePersona();
  const { t, pick } = useI18n();
  const mutation = useMutation({
    mutationFn: () => {
      if (!branch) return Promise.reject(new Error("Missing branch"));
      return branch.isActive
        ? api.branches.deactivate(persona, branch.id)
        : api.branches.reactivate(persona, branch.id);
    },
    onSuccess: () => {
      if (!branch) return;
      void queryClient.invalidateQueries({ queryKey: branchKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["platform", "clinics"] });
      toast.success(t(branch.isActive ? "branches.deactivated" : "branches.reactivated"));
      onClose();
    },
    onError: (error) => toast.error(t(`errors.${errorCodeOf(error)}`)),
  });

  return (
    <AlertDialog
      open={Boolean(branch)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader className="text-start">
          <AlertDialogTitle>
            {t(branch?.isActive ? "branches.deactivateTitle" : "branches.reactivateTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {branch ? `${pick(branch.nameAr, branch.nameEn)} — ` : ""}
            {t(branch?.isActive ? "branches.deactivateBody" : "branches.reactivateBody")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:space-x-0">
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              mutation.mutate();
            }}
            disabled={mutation.isPending}
          >
            {t(branch?.isActive ? "branches.deactivate" : "branches.reactivate")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
