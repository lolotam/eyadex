import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { personaSchema, type Persona, type SessionContext } from "@contracts/session";
import { useApi } from "@/shared/api/api-provider";

const STORAGE_KEY = "eyadex:persona";
const MOCK_RESET_EVENT = "eyadex:mock-reset";
const DEFAULT_PERSONA: Persona = { kind: "platform_admin", clinicId: null, memberId: null };

type PersonaValue = {
  persona: Persona;
  ready: boolean;
  setPersona: (persona: Persona) => void;
};

const PersonaContext = createContext<PersonaValue | null>(null);

export function PersonaProvider({ children }: { children: ReactNode }) {
  const [persona, setPersonaState] = useState<Persona>(DEFAULT_PERSONA);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = personaSchema.safeParse(JSON.parse(raw));
      if (parsed.success) setPersonaState(parsed.data);
    }
    setReady(true);
    // The demo data was reseeded (new version): the saved persona no longer exists.
    const reset = () => setPersonaState(DEFAULT_PERSONA);
    window.addEventListener(MOCK_RESET_EVENT, reset);
    return () => window.removeEventListener(MOCK_RESET_EVENT, reset);
  }, []);

  const setPersona = useCallback((next: Persona) => {
    setPersonaState(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  return (
    <PersonaContext.Provider value={{ persona, ready, setPersona }}>
      {children}
    </PersonaContext.Provider>
  );
}

export function usePersona(): PersonaValue {
  const value = useContext(PersonaContext);
  if (!value) throw new Error("usePersona must be used inside PersonaProvider");
  return value;
}

export function useSession(): {
  session: SessionContext | undefined;
  isLoading: boolean;
  error: unknown;
} {
  const api = useApi();
  const { persona, ready } = usePersona();
  const query = useQuery({
    queryKey: ["session", persona.kind, persona.clinicId, persona.memberId],
    queryFn: () => api.session.getContext(persona),
    enabled: ready,
    retry: false,
    // Time-based state (expiry banner days, expiry block) must move while a tab stays open.
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });
  return { session: query.data, isLoading: !ready || query.isLoading, error: query.error };
}
