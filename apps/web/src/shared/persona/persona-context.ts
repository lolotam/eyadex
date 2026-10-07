import { createContext } from "react";
import type { Persona, SessionContext } from "@eyadex/contracts/session";
import type { Area } from "@/shared/api/area-host";

export const DEFAULT_PERSONA: Persona = { kind: "platform_admin", clinicId: null, memberId: null };

export type SessionState = {
  session: SessionContext | undefined;
  isLoading: boolean;
  error: unknown;
};

export type PersonaValue = {
  persona: Persona;
  ready: boolean;
  setPersona: (persona: Persona) => void;
  /** HTTP mode only: the session read from the cookie, and the area of the current host. */
  http?: SessionState & { area: Area | null | undefined };
};

export const PersonaContext = createContext<PersonaValue | null>(null);

/** One query key for the session in both modes, so sign-in and sign-out can reset it. */
export const SESSION_KEY = ["session"] as const;
