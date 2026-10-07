import { useCallback, useEffect, useState, type ReactNode } from "react";
import { personaSchema, type Persona } from "@eyadex/contracts/session";
import { DEFAULT_PERSONA, PersonaContext } from "./persona-context";

const STORAGE_KEY = "eyadex:persona";
const MOCK_RESET_EVENT = "eyadex:mock-reset";

/** Demo sign-in: the persona picked in the switcher, kept in browser storage (read in an effect). */
export function MockPersonaProvider({ children }: { children: ReactNode }) {
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
