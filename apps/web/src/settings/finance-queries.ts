import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { financeSettingsKey } from "@/shared/money/use-clinic-money";
import { usePersona, useSession } from "@/shared/persona/persona-provider";

const retry = (count: number, error: unknown) => !(error instanceof ApiError) && count < 2;

function useFinanceOn() {
  const { persona, ready } = usePersona();
  const { session } = useSession();
  return {
    persona,
    enabled: ready && Boolean(persona.clinicId) && session?.features.finance === true,
  };
}

/** The branches' invoice prefixes; asked only by a holder of `update:branches:clinic`. */
export function useInvoicePrefixes(allowed: boolean) {
  const api = useApi();
  const { persona, enabled } = useFinanceOn();
  return useQuery({
    queryKey: [...financeSettingsKey, "prefixes", persona.clinicId, persona.memberId],
    queryFn: () => api.finance.prefixes(persona),
    enabled: enabled && allowed,
    retry,
  });
}

/** The clinic logo as an object URL, or null when there is none yet. */
export function useClinicLogo(hasLogo: boolean) {
  const api = useApi();
  const { persona, enabled } = useFinanceOn();
  return useQuery({
    queryKey: [...financeSettingsKey, "logo", persona.clinicId, hasLogo],
    queryFn: async () => {
      const blob = await api.finance.logo(persona);
      return blob ? URL.createObjectURL(blob) : null;
    },
    enabled: enabled && hasLogo,
    retry,
    staleTime: Infinity,
  });
}

export function useRefreshFinanceSettings() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: financeSettingsKey });
}
