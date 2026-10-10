import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { Stethoscope } from "lucide-react";
import { toast } from "sonner";
import type { Appointment } from "@eyadex/contracts/appointments";
import { Button } from "@/components/ui/button";
import { ApiError, errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { can } from "@/shared/permissions/can";
import { usePersona, useSession } from "@/shared/persona/persona-provider";

/** "Start visit" on an arrived appointment for its provider (P2-2); an existing visit opens instead. */
export function StartVisitButton({
  appointment,
  compact = false,
}: {
  appointment: Appointment;
  compact?: boolean;
}) {
  const api = useApi();
  const { persona } = usePersona();
  const { session } = useSession();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [key] = useState(() => crypto.randomUUID());
  const permissions = session?.permissions ?? [];
  const open = (visitId: string) =>
    void navigate({ to: "/clinic/visits/$visitId", params: { visitId } });
  const start = useMutation({
    mutationFn: () => api.medical.startVisit(persona, { appointmentId: appointment.id }, key),
    onSuccess: (detail) => open(detail.visit.id),
    onError: (e) => {
      const visitId = e instanceof ApiError ? e.details["visitId"] : undefined;
      if (errorCodeOf(e) === "visit_exists" && typeof visitId === "string") open(visitId);
      else toast.error(t(`errors.${errorCodeOf(e)}`));
    },
  });
  if (appointment.status !== "arrived") return null;
  if (!can(permissions, "create", "visits", ["own"])) return null;
  // The session names the caller's clinic membership: only the provider starts the visit.
  if (!session?.membershipId || session.membershipId !== appointment.providerMembershipId) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      className={compact ? "h-6 px-1.5 text-[11px]" : undefined}
      disabled={start.isPending}
      onClick={(e) => {
        e.stopPropagation();
        start.mutate();
      }}
    >
      <Stethoscope className="size-3.5" />
      {t("visits.start")}
    </Button>
  );
}
