import { vi } from "vitest";
import type { Persona } from "@contracts/session";

vi.mock("@/shared/api/mock/mock-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/shared/api/mock/mock-store")>();
  return { ...real, delay: async () => undefined };
});

const { createMockApiClient } = await import("@/shared/api/mock/mock-adapter");
const store = await import("@/shared/api/mock/mock-store");

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

export const CLINIC_QUERY = {
  cursor: null,
  limit: 100,
  actor: "",
  action: null,
  entity: null,
  category: null,
  from: null,
  to: null,
};
export const PLATFORM_QUERY = { ...CLINIC_QUERY, category: undefined, source: null };

/** Writes administrative and patient-access entries in clinic 0 (and a branch edit in clinic 1). */
export async function seedActivity(): Promise<{ patientId: string; civilId: string }> {
  const db = store.getState();
  const branch = db.branches.find((b) => b.clinicId === clinicIdAt(0));
  const other = db.branches.find((b) => b.clinicId === clinicIdAt(1));
  if (!branch || !other) throw new Error("no branch");
  const input = { nameAr: branch.nameAr, nameEn: `${branch.nameEn} 2`, address: "", phone: "" };
  await api.branches.update(as("clinic_admin"), branch.id, input);
  await api.branches.update(as("clinic_admin", 1), other.id, {
    nameAr: other.nameAr,
    nameEn: `${other.nameEn} B`,
    address: "",
    phone: "",
  });
  const civilId = "290040112345";
  const created = await api.patients.create(as("clinic_admin"), {
    fullName: "مراجع تجريبي",
    phone: "55501234",
    birthDate: "1990-04-01",
    gender: "male",
    registrationBranchId: branch.id,
    civilId,
  });
  await api.patients.open(as("clinic_admin"), created.id);
  return { patientId: created.id, civilId };
}
