import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Plus } from "lucide-react";
import { toast } from "sonner";
import type { PlatformAccount } from "@contracts/platform";
import { Button } from "@/components/ui/button";
import { useApi } from "@/shared/api/api-provider";
import { errorCodeOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { PageHeader } from "@/shared/shell/page-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { DataTable } from "@/shared/table/data-table";
import { ConfirmActionDialog } from "@/shared/shell/confirm-action-dialog";
import { usePlatformTeam, useRefreshPlatform } from "./platform-queries";
import { InviteTeamDialog } from "./invite-team-dialog";
import { useTeamColumns } from "./use-team-columns";

export function PlatformTeamPage() {
  const { t } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const query = usePlatformTeam();
  const refresh = useRefreshPlatform();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [target, setTarget] = useState<PlatformAccount | null>(null);
  const deactivating = target?.status !== "deactivated";

  const mutation = useMutation({
    mutationFn: (a: PlatformAccount) =>
      a.status === "deactivated"
        ? api.platformTeam.reactivate(persona, a.id)
        : api.platformTeam.deactivate(persona, a.id),
    onSuccess: (a) => {
      refresh();
      toast.success(t(a.status === "deactivated" ? "team.deactivated" : "team.reactivated"));
      setTarget(null);
    },
    onError: (e) => toast.error(t(`errors.${errorCodeOf(e)}`)),
  });
  const columns = useTeamColumns(setTarget);

  return (
    <div>
      <PageHeader
        title={t("team.title")}
        subtitle={t("team.subtitle")}
        actions={
          <Button onClick={() => setInviteOpen(true)}>
            <Plus className="size-4" />
            {t("team.invite")}
          </Button>
        }
      />
      {query.isLoading ? (
        <LoadingBlock />
      ) : !query.data ? (
        <StatusPanel icon={AlertTriangle} title={t("team.loadError")} body="" />
      ) : (
        <DataTable
          columns={columns}
          data={query.data}
          minWidthClass="min-w-[640px]"
          stickyEndColumnId="actions"
        />
      )}
      <InviteTeamDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      <ConfirmActionDialog
        open={target !== null}
        title={t(deactivating ? "team.deactivateTitle" : "team.reactivateTitle", {
          name: target?.fullName ?? "",
        })}
        body={t(deactivating ? "team.deactivateBody" : "team.reactivateBody")}
        confirmLabel={t(deactivating ? "team.deactivate" : "team.reactivate")}
        cancelLabel={t("common.cancel")}
        pending={mutation.isPending}
        onConfirm={() => target && mutation.mutate(target)}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
