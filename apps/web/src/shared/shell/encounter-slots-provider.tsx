import type { ReactNode } from "react";
import { SlotsContext, type EncounterSlots } from "./encounter-slots-context";

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
