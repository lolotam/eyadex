import type { PatientInput } from "@contracts/patients";
import type { Persona } from "@contracts/session";
import { createMockApiClient } from "@/shared/api/mock/mock-adapter";
import { getState } from "@/shared/api/mock/mock-store";

/** Shared fixtures for the patients mock tests (each test file mocks the store's delay). */
export const api = createMockApiClient();

export function clinicId() {
  const clinic = getState().clinics[0];
  if (!clinic) throw new Error("no clinic");
  return clinic.id;
}
export const as = (kind: Persona["kind"]): Persona => ({
  kind,
  clinicId: clinicId(),
  memberId: null,
});
export function memberOf(kind: string) {
  const db = getState();
  const role = db.roles.find((r) => r.clinicId === clinicId() && r.systemKey === kind);
  const m = db.members.find((x) => x.roleId === role?.id && x.status === "active");
  if (!m) throw new Error(kind);
  return m;
}
export function branches() {
  return getState().branches.filter((b) => b.clinicId === clinicId());
}
export function otherBranchThan(ids: readonly string[]) {
  const b = branches().find((x) => !ids.includes(x.id));
  if (!b) throw new Error("no other branch");
  return b;
}
export function input(branchId: string, phone = "55501234"): PatientInput {
  return {
    fullName: "مراجع تجريبي",
    phone,
    birthDate: "1990-04-01",
    gender: "male",
    registrationBranchId: branchId,
    civilId: "290040112345",
  };
}
export const ALL = { cursor: null, limit: 100, q: "", branchId: null, status: null };
