import { useState } from "react";
import { AlertCircle } from "lucide-react";
import type { Appointment } from "@eyadex/contracts/appointments";
import { Button } from "@/components/ui/button";
import { errorCodeOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { StatusPanel } from "@/shared/shell/status-panel";
import { useAppointmentDay } from "./appointment-queries";
import { CancelDialog } from "./cancel-dialog";
import { QueueView } from "./queue-view";

type Props = { branchId: string; today: string };

/** Today's queue (slice A4): the branch day for the clinic's today; no endpoint of its own. */
export function QueuePanel({ branchId, today }: Props) {
  const { t } = useI18n();
  const day = useAppointmentDay(branchId, today);
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  if (day.error) {
    return (
      <StatusPanel
        icon={AlertCircle}
        title={t("appointments.loadError")}
        body={t(`errors.${errorCodeOf(day.error)}`)}
        action={<Button onClick={() => void day.refetch()}>{t("common.tryAgain")}</Button>}
      />
    );
  }
  if (day.isLoading || !day.data) return <LoadingBlock />;
  return (
    <>
      <QueueView day={day.data} onCancel={setCancelling} />
      <CancelDialog appointment={cancelling} onClose={() => setCancelling(null)} />
    </>
  );
}
