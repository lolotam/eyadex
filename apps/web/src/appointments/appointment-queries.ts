import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";

export const appointmentKeys = { all: ["clinic", "appointments"] as const };

const retry = (count: number, error: unknown) => !(error instanceof ApiError) && count < 2;

function usePersonaKey() {
  const { persona, ready } = usePersona();
  return {
    persona,
    enabled: ready && persona.kind !== "platform_admin" && Boolean(persona.clinicId),
    key: [persona.kind, persona.clinicId, persona.memberId] as const,
  };
}

export function useAppointmentBranches() {
  const api = useApi();
  const { persona, enabled, key } = usePersonaKey();
  return useQuery({
    queryKey: [...appointmentKeys.all, "branches", ...key],
    queryFn: () => api.appointments.listBranches(persona),
    enabled,
    retry,
  });
}

export function useAppointmentDay(branchId: string | null, date: string) {
  const api = useApi();
  const { persona, enabled, key } = usePersonaKey();
  return useQuery({
    queryKey: [...appointmentKeys.all, "day", branchId, date, ...key],
    queryFn: () => api.appointments.day(persona, { branchId: branchId ?? "", date }),
    enabled: enabled && branchId !== null,
    retry,
  });
}

/** The active services for the booking dialog; none when the caller cannot view them. */
export function useBookingServices(allowed: boolean) {
  const api = useApi();
  const { persona, enabled, key } = usePersonaKey();
  return useQuery({
    queryKey: [...appointmentKeys.all, "services", ...key],
    queryFn: async () =>
      (await api.scheduling.listServices(persona, { cursor: null, limit: 100, status: "active" }))
        .items,
    enabled: enabled && allowed,
    retry,
  });
}

export function useRefreshAppointments() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: appointmentKeys.all });
}
