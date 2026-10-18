import { createContext, useContext, type ReactNode } from "react";

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

const SlotsContext = createContext<EncounterSlots>({});

/** Given by a route around the page it composes. */
export function EncounterSlotsProvider({
  slots,
  children,
}: {
  slots: EncounterSlots;
  children: ReactNode;
}) {
  return <SlotsContext.Provider value={slots}>{children}</SlotsContext.Provider>;
}

/** What the composing route gave; nothing outside one. */
export const useEncounterSlots = (): EncounterSlots => useContext(SlotsContext);
