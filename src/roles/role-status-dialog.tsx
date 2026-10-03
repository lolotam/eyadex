import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import type { RoleListItem } from "@contracts/roles";
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
import { useRefreshRoles } from "./role-queries";

export function RoleStatusDialog({
  role,
  onClose,
}: {
  role: RoleListItem | null;
  onClose: () => void;
}) {
  const api = useApi();
  const refresh = useRefreshRoles();
  const { persona } = usePersona();
  const { t, pick } = useI18n();
  const mutation = useMutation({
    mutationFn: () => {
      if (!role) return Promise.reject(new Error("Missing role"));
      return role.isActive
        ? api.roles.deactivate(persona, role.id)
        : api.roles.reactivate(persona, role.id);
    },
    onSuccess: () => {
      if (!role) return;
      refresh();
      toast.success(t(role.isActive ? "roles.deactivated" : "roles.reactivated"));
      onClose();
    },
    onError: (error) =>
      toast.error(
        t(`errors.${errorCodeOf(error)}`, error instanceof ApiError ? error.details : undefined),
      ),
  });

  return (
    <AlertDialog
      open={Boolean(role)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader className="text-start">
          <AlertDialogTitle>
            {t(role?.isActive ? "roles.deactivateTitle" : "roles.reactivateTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {role ? `${pick(role.nameAr, role.nameEn)} — ` : ""}
            {t(role?.isActive ? "roles.deactivateBody" : "roles.reactivateBody")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {role?.isActive && role.memberCount > 0 && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {t("errors.role_in_use", { count: role.memberCount })}
          </p>
        )}
        <AlertDialogFooter className="gap-2 sm:space-x-0">
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              mutation.mutate();
            }}
            disabled={mutation.isPending}
          >
            {t(role?.isActive ? "roles.deactivate" : "roles.reactivate")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
