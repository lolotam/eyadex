import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { personaSchema, type Persona, type SessionContext } from "@contracts/session";
import { useApi } from "@/shared/api/api-provider";

const STORAGE_KEY = "eyadex:persona";
const DEFAULT_PERSONA: Persona = { kind: "platform_admin", clinicId: null };

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
  }, []);

  const setPersona = useCallback((next: Persona) => {
    setPersonaState(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  return <PersonaContext.Provider value={{ persona, ready, setPersona }}>{children}</PersonaContext.Provider>;
}

export function usePersona(): PersonaValue {
  const value = useContext(PersonaContext);
  if (!value) throw new Error("usePersona must be used inside PersonaProvider");
  return value;
}

export function useSession(): { session: SessionContext | undefined; isLoading: boolean } {
  const api = useApi();
  const { persona, ready } = usePersona();
  const query = useQuery({
    queryKey: ["session", persona.kind, persona.clinicId],
    queryFn: () => api.session.getContext(persona),
    enabled: ready,
  });
  return { session: query.data, isLoading: !ready || query.isLoading };
}
