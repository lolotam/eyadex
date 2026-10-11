import type { MockState } from "./mock-store";

// D-4 (spec §3, ADR-0026 A3), P2 spec §2, the API's `own-patients.ts` predicate: a file is the member's
// own when it has at least one appointment with them that is not cancelled, past or future, in any
// branch, or any visit whose provider they are, in any status (R1-18). One predicate for patients,
// visits and the clinical content.

/** Is the file the member's own? */
export const isOwnPatient = (
  db: MockState,
  clinicId: string,
  membershipId: string,
  patientId: string,
): boolean =>
  db.appointments.some(
    (a) =>
      a.clinicId === clinicId &&
      a.patientId === patientId &&
      a.providerMembershipId === membershipId &&
      a.status !== "cancelled",
  ) ||
  db.medical.visits.some(
    (v) =>
      v.clinicId === clinicId &&
      v.patientId === patientId &&
      v.providerMembershipId === membershipId,
  );
