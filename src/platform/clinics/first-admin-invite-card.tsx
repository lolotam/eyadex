import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { InvitationStatusBadge } from "@/shared/status/invitation-status-badge";
import { clinicKeys } from "./clinic-queries";
import { FirstAdminLinkPanel } from "./first-admin-link-panel";

/** Story 19: while no clinic admin has accepted, the platform can resend the first-admin invitation. */
export function FirstAdminInviteCard({ clinicId }: { clinicId: string }) {
  const api = useApi();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const key = [...clinicKeys.all, "first-admin", clinicId];
  const invite = useQuery({
    queryKey: key,
    queryFn: () => api.platform.getFirstAdminInvitation(clinicId),
  });
  const resend = useMutation({
    mutationFn: () => api.platform.resendFirstAdminInvitation(clinicId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      toast.success(t("clinics.firstAdmin.resent"));
    },
    onError: (error) => toast.error(t(`errors.${errorCodeOf(error)}`)),
  });
  const data = invite.data;
  if (!data) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border bg-card p-4">
        <div className="min-w-0">
          <p className="font-medium">{t("clinics.firstAdmin.pendingTitle")}</p>
          <p className="truncate text-sm text-muted-foreground">
            {data.fullName} · <span dir="ltr">{data.email}</span>
          </p>
          <div className="mt-2">
            <InvitationStatusBadge status={data.status} />
          </div>
        </div>
        {data.status !== "cancelled" && (
          <Button type="button" onClick={() => resend.mutate()} disabled={resend.isPending}>
            <Send aria-hidden />
            {t("clinics.firstAdmin.resend")}
          </Button>
        )}
      </div>
      {resend.data && <FirstAdminLinkPanel invite={resend.data} />}
    </div>
  );
}
