import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Invitation } from "@eyadex/contracts/invitations";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { ConfirmActionDialog } from "@/shared/shell/confirm-action-dialog";
import { userErrorMessage } from "./user-error-message";
import { useRefreshUsers } from "./user-queries";

/** Confirms, makes a new link (the emailed one stops working) and copies it. */
export function CopyInvitationLinkDialog({
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
    mutationFn: () => api.invitations.copyLink(persona, invitation?.id ?? ""),
    onSuccess: (link) => {
      refresh();
      onClose();
      const url = `${window.location.origin}/invite/${link.token}`;
      const copied = navigator.clipboard?.writeText(url);
      if (!copied) {
        toast.message(url);
        return;
      }
      void copied.then(() => toast.success(t("users.linkCopied"))).catch(() => toast.message(url));
    },
    onError: (error) => toast.error(userErrorMessage(t, error)),
  });

  return (
    <ConfirmActionDialog
      open={Boolean(invitation)}
      title={t("users.copyLinkTitle", { email: invitation?.email ?? "" })}
      body={t("users.copyLinkBody")}
      confirmLabel={t("users.copyLinkConfirm")}
      cancelLabel={t("users.keepInvitation")}
      pending={mutation.isPending}
      onConfirm={() => mutation.mutate()}
      onClose={onClose}
    />
  );
}
