import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MoreVertical } from "lucide-react";
import { toast } from "sonner";
import {
  canTransition,
  isBillable,
  isReschedulable,
  type Appointment,
} from "@eyadex/contracts/appointments";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { InvoiceSourceMenuItem } from "@/shared/finance/invoice-source-menu-item";
import { useRefreshAppointments } from "./appointment-queries";
import { MessageHistoryDialog } from "./message-history-dialog";

const MOVES = ["arrived", "completed", "no_show"] as const;

type Props = {
  appointment: Appointment;
  canUpdate: boolean;
  /** Absent in today's queue, which offers only the status moves and cancel. */
  onReschedule?: (appointment: Appointment) => void;
  onCancel: (appointment: Appointment) => void;
};

/** The block's menu: only the moves D-5 allows from its status (UX; the API refuses as well). */
export function AppointmentActions({ appointment, canUpdate, onReschedule, onCancel }: Props) {
  const api = useApi();
  const { persona } = usePersona();
  const { t } = useI18n();
  const refresh = useRefreshAppointments();
  const [messages, setMessages] = useState(false);
  const status = useMutation({
    mutationFn: (to: (typeof MOVES)[number]) =>
      api.appointments.setStatus(persona, appointment.id, { status: to }),
    onSuccess: () => {
      refresh();
      toast.success(t("appointments.statusDone"));
    },
    onError: (e) => toast.error(t(`errors.${errorCodeOf(e)}`)),
  });
  // Viewing a visible appointment also permits its history; only writes need update permission.
  const moves = canUpdate ? MOVES.filter((to) => canTransition(appointment.status, to)) : [];
  const cancellable = canUpdate && canTransition(appointment.status, "cancelled");
  const movable = canUpdate && onReschedule !== undefined && isReschedulable(appointment.status);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="-me-1 size-4 shrink-0"
            aria-label={t("appointments.actions.menu")}
          >
            <MoreVertical className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {moves.map((to) => (
            <DropdownMenuItem
              key={to}
              disabled={status.isPending}
              onSelect={() => status.mutate(to)}
            >
              {t(`appointments.actions.${to}`)}
            </DropdownMenuItem>
          ))}
          {movable && (
            <DropdownMenuItem onSelect={() => onReschedule?.(appointment)}>
              {t("appointments.actions.reschedule")}
            </DropdownMenuItem>
          )}
          {(moves.length > 0 || movable) && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={() => setMessages(true)}>
            {t("messageHistory.title")}
          </DropdownMenuItem>
          {isBillable(appointment.status) && (
            <InvoiceSourceMenuItem appointmentId={appointment.id} branchId={appointment.branchId} />
          )}
          {cancellable && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onSelect={() => onCancel(appointment)}>
                {t("appointments.actions.cancel")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <MessageHistoryDialog
        appointmentId={messages ? appointment.id : null}
        patientName={appointment.patientName}
        onClose={() => setMessages(false)}
      />
    </>
  );
}
