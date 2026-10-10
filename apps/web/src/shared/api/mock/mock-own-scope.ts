import type { MockState } from "./mock-store";

// D-4 (spec §3, ADR-0026 A3), the API's `own-patients.ts` predicate: a file is the member's own when it
// has at least one appointment with them that is not cancelled, past or future, in any branch.

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
  );
