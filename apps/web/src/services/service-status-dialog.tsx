import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ClinicService } from "@eyadex/contracts/services";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { ConfirmActionDialog } from "@/shared/shell/confirm-action-dialog";
import { useRefreshServices } from "./service-queries";

export function ServiceStatusDialog({
  service,
  onClose,
}: {
  service: ClinicService | null;
  onClose: () => void;
}) {
  const api = useApi();
  const { persona } = usePersona();
  const { t } = useI18n();
  const refresh = useRefreshServices();
  const active = service?.status === "active";
  const mutation = useMutation({
    mutationFn: (s: ClinicService) =>
      s.status === "active"
        ? api.scheduling.deactivateService(persona, s.id)
        : api.scheduling.reactivateService(persona, s.id),
    onSuccess: (s) => {
      refresh();
      toast.success(t(s.status === "active" ? "services.reactivated" : "services.deactivated"));
      onClose();
    },
    onError: (error) => toast.error(t(`errors.${errorCodeOf(error)}`)),
  });
  return (
    <ConfirmActionDialog
      open={Boolean(service)}
      title={t(active ? "services.deactivateTitle" : "services.reactivateTitle")}
      body={t(active ? "services.deactivateBody" : "services.reactivateBody")}
      confirmLabel={t(active ? "services.deactivate" : "services.reactivate")}
      cancelLabel={t("common.cancel")}
      pending={mutation.isPending}
      onConfirm={() => service && mutation.mutate(service)}
      onClose={onClose}
    />
  );
}
