import { useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/shared/api/api-provider";
import {
  PersonaContext,
  SESSION_KEY,
  type PersonaValue,
  type SessionState,
} from "./persona-context";

export function usePersona(): PersonaValue {
  const value = useContext(PersonaContext);
  if (!value) throw new Error("usePersona must be used inside PersonaProvider");
  return value;
}

export function useSession(): SessionState {
  const api = useApi();
  const value = usePersona();
  const { persona, ready } = value;
  const query = useQuery({
    queryKey: [...SESSION_KEY, persona.kind, persona.clinicId, persona.memberId],
    queryFn: () => api.session.getContext(persona),
    // HTTP mode reads the session once, in its provider.
    enabled: ready && !value.http,
    retry: false,
    // Time-based state (expiry banner days, expiry block) must move while a tab stays open.
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });
  if (value.http) {
    const { session, isLoading, error } = value.http;
    return { session, isLoading, error };
  }
  return { session: query.data, isLoading: !ready || query.isLoading, error: query.error };
}
