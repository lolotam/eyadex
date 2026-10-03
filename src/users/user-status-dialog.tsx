import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import type { MembershipUserView } from "@contracts/users";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { ConfirmActionDialog } from "./confirm-action-dialog";
import { userErrorMessage } from "./user-error-message";
import { useRefreshUsers } from "./user-queries";

export function UserStatusDialog({
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
  const deactivating = user?.status === "active";
  const mutation = useMutation({
    mutationFn: () => {
      if (!user) return Promise.reject(new Error("Missing user"));
      return deactivating
        ? api.users.deactivate(persona, user.id)
        : api.users.reactivate(persona, user.id);
    },
    onSuccess: () => {
      refresh();
      toast.success(t(deactivating ? "users.deactivated" : "users.reactivated"));
      onClose();
    },
    onError: (error) => toast.error(userErrorMessage(t, error)),
  });
  const name = user?.fullName ?? "";

  return (
    <ConfirmActionDialog
      open={Boolean(user)}
      title={t(deactivating ? "users.deactivateTitle" : "users.reactivateTitle", { name })}
      body={t(deactivating ? "users.deactivateBody" : "users.reactivateBody")}
      confirmLabel={t(deactivating ? "users.actions.deactivate" : "users.actions.reactivate")}
      cancelLabel={t("common.cancel")}
      pending={mutation.isPending}
      onConfirm={() => mutation.mutate()}
      onClose={onClose}
    />
  );
}
