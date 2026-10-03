/** Mock API test kit shared by every area: delay-free store, personas, the client. */
import { vi } from "vitest";
import type { Persona } from "@contracts/session";

vi.mock("@/shared/api/mock/mock-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/shared/api/mock/mock-store")>();
  return { ...real, delay: async () => undefined };
});

const { createMockApiClient } = await import("@/shared/api/mock/mock-adapter");
export const store = await import("@/shared/api/mock/mock-store");

export const api = createMockApiClient();
export const { getState, resetMockData } = store;

export function clinicIdAt(index: number): string {
  const clinic = store.getState().clinics[index];
  if (!clinic) throw new Error("no clinic");
  return clinic.id;
}
export const as = (kind: Persona["kind"], index = 0): Persona => ({
  kind,
  clinicId: kind === "platform_admin" ? null : clinicIdAt(index),
  memberId: null,
});
export const PLATFORM: Persona = { kind: "platform_admin", clinicId: null, memberId: null };
