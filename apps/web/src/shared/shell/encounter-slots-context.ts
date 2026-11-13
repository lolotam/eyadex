import { createContext, useContext } from "react";
import type { ReactNode } from "react";

/**
 * ADR-0030: a route puts another area's control into an appointment menu or a visit header. The
 * hosting area renders whatever the route gave, and knows nothing of what it is.
 */
export type EncounterSlots = {
  appointmentMenu?: (appointment: { id: string; branchId: string }) => ReactNode;
  visitActions?: (visit: {
    id: string;
    appointmentId: string | null;
    branchId: string;
  }) => ReactNode;
};

export const SlotsContext = createContext<EncounterSlots>({});

/** What the composing route gave; nothing outside one. */
export const useEncounterSlots = (): EncounterSlots => useContext(SlotsContext);
