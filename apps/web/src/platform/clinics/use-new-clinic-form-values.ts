import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CreateClinicInput } from "@eyadex/contracts/clinics";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { newClinicFormValues } from "./new-clinic-form-values";

/**
 * The create form's first values, from a read of the platform settings made after the page opened:
 * a cached copy may predate another admin's change, and the form would send it unnoticed. Once
 * taken, the values stay put, so a later refetch never rewrites what the super admin is editing.
 * Same query key as the settings page, so saving the settings refreshes it.
 */
export function useNewClinicFormValues(): { values: CreateClinicInput | null; failed: boolean } {
  const api = useApi();
  const { persona, ready } = usePersona();
  const settings = useQuery({
    queryKey: ["platform", "settings", persona.kind, persona.memberId],
    queryFn: () => api.platformSettings.get(persona),
    enabled: ready,
    refetchOnMount: "always",
    retry: false,
  });
  const [values, setValues] = useState<CreateClinicInput | null>(null);
  const fresh = settings.isFetchedAfterMount && !settings.isFetching && !settings.isError;
  if (values === null && fresh && settings.data) setValues(newClinicFormValues(settings.data));
  return { values, failed: values === null && settings.isError };
}
