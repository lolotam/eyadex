import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ClinicService } from "@eyadex/contracts/services";
import type { Persona } from "@eyadex/contracts/session";
import type { ApiClient } from "@/shared/api/api-client";
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

export function useAppointmentWeek(
  branchId: string | null,
  providerMembershipId: string | null,
  weekStart: string,
) {
  const api = useApi();
  const { persona, enabled, key } = usePersonaKey();
  return useQuery({
    queryKey: [...appointmentKeys.all, "week", branchId, providerMembershipId, weekStart, ...key],
    queryFn: () =>
      api.appointments.week(persona, {
        branchId: branchId ?? "",
        providerMembershipId: providerMembershipId ?? "",
        weekStart,
      }),
    enabled: enabled && branchId !== null && providerMembershipId !== null,
    retry,
  });
}

export function useAppointmentMonth(
  branchId: string | null,
  month: string,
  providerMembershipId: string | null,
) {
  const api = useApi();
  const { persona, enabled, key } = usePersonaKey();
  return useQuery({
    queryKey: [...appointmentKeys.all, "month", branchId, month, providerMembershipId, ...key],
    queryFn: () =>
      api.appointments.month(persona, {
        branchId: branchId ?? "",
        month,
        ...(providerMembershipId ? { providerMembershipId } : {}),
      }),
    enabled: enabled && branchId !== null,
    retry,
  });
}

/** Every active service, page after page (the list API caps a page at 100). */
export async function allActiveServices(
  api: ApiClient,
  persona: Persona,
): Promise<ClinicService[]> {
  const out: ClinicService[] = [];
  let cursor: string | null = null;
  do {
    const page = await api.scheduling.listServices(persona, {
      cursor,
      limit: 100,
      status: "active",
    });
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return out;
}

/** The active services for the booking dialog; none when the caller cannot view them. */
export function useBookingServices(allowed: boolean) {
  const api = useApi();
  const { persona, enabled, key } = usePersonaKey();
  return useQuery({
    queryKey: [...appointmentKeys.all, "services", ...key],
    queryFn: () => allActiveServices(api, persona),
    enabled: enabled && allowed,
    retry,
  });
}

export function useRefreshAppointments() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: appointmentKeys.all });
}
