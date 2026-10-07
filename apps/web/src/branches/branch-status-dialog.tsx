import { useState } from "react";
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
import { ApiError, errorCodeOf } from "@/shared/api/api-error";
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
  // Set by the API's 409: how many active users would be left with no branch (ADR-0012).
  const [stranded, setStranded] = useState<number | null>(null);
  const close = () => {
    setStranded(null);
    onClose();
  };
  const mutation = useMutation({
    mutationFn: (confirmStrandedMembers: boolean) => {
      if (!branch) return Promise.reject(new Error("Missing branch"));
      return branch.isActive
        ? api.branches.deactivate(persona, branch.id, { confirmStrandedMembers })
        : api.branches.reactivate(persona, branch.id);
    },
    onSuccess: () => {
      if (!branch) return;
      void queryClient.invalidateQueries({ queryKey: branchKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["platform", "clinics"] });
      toast.success(t(branch.isActive ? "branches.deactivated" : "branches.reactivated"));
      close();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "branch_has_exclusive_members") {
        setStranded(Number(error.details["count"] ?? 0));
        return;
      }
      toast.error(t(`errors.${errorCodeOf(error)}`));
    },
  });
  const name = branch ? `${pick(branch.nameAr, branch.nameEn)} — ` : "";
  const title =
    stranded !== null
      ? t("branchStranded.title")
      : t(branch?.isActive ? "branches.deactivateTitle" : "branches.reactivateTitle");
  const body =
    stranded !== null
      ? t("branchStranded.body", { count: stranded })
      : t(branch?.isActive ? "branches.deactivateBody" : "branches.reactivateBody");
  const confirmLabel =
    stranded !== null
      ? t("branchStranded.confirm")
      : t(branch?.isActive ? "branches.deactivate" : "branches.reactivate");

  return (
    <AlertDialog
      open={Boolean(branch)}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader className="text-start">
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {name}
            {body}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:space-x-0">
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              mutation.mutate(stranded !== null);
            }}
            disabled={mutation.isPending}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
