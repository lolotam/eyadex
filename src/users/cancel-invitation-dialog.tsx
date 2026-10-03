import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Invitation } from "@contracts/invitations";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { ConfirmActionDialog } from "@/shared/shell/confirm-action-dialog";
import { userErrorMessage } from "./user-error-message";
import { useRefreshUsers } from "./user-queries";

export function CancelInvitationDialog({
  invitation,
  onClose,
}: {
  invitation: Invitation | null;
  onClose: () => void;
}) {
  const api = useApi();
  const { persona } = usePersona();
  const { t } = useI18n();
  const refresh = useRefreshUsers();
  const mutation = useMutation({
    mutationFn: () => api.invitations.cancel(persona, invitation?.id ?? ""),
    onSuccess: () => {
      refresh();
      toast.success(t("users.cancelled"));
      onClose();
    },
    onError: (error) => toast.error(userErrorMessage(t, error)),
  });

  return (
    <ConfirmActionDialog
      open={Boolean(invitation)}
      title={t("users.cancelTitle", { email: invitation?.email ?? "" })}
      body={t("users.cancelBody")}
      confirmLabel={t("users.actions.cancel")}
      cancelLabel={t("users.keepInvitation")}
      pending={mutation.isPending}
      onConfirm={() => mutation.mutate()}
      onClose={onClose}
    />
  );
}
