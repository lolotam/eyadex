import { walkInSearchSchema } from "@eyadex/contracts/visits";
import { searchDigits } from "@eyadex/contracts/patients";
import { ApiError } from "../api-error";
import type { MedicalApi } from "../medical-client";
import { fileNumberMatches } from "./mock-patient-rules";
import { parse, requireKey, type MedicalAccess } from "./mock-medical-access";
import { auditMedical } from "./mock-medical-project";
import { delay, getState, persist, type MockState } from "./mock-store";

/** The guard's branch scope (active branches only, as the API's member reader). */
export const worksIn = (a: MedicalAccess, branchId: string) =>
  a.branches.allBranches || a.branches.branchIds.includes(branchId);

// As the API's walk-in (start-visit.ts, visit-reads.ts): a branch of another clinic or none is
// `not_found`, a closed one `branch_inactive` (Codex 4241493936).
export function requireOpenBranch(db: MockState, a: MedicalAccess, branchId: string) {
  const branch = db.branches.find((b) => b.clinicId === a.clinic.id && b.id === branchId);
  if (!branch) throw new ApiError("not_found");
  if (!branch.isActive) throw new ApiError("branch_inactive");
}

/**
 * The active branches where the caller may start a walk-in (R3), in the API's `listForOptions` order:
 * by the name in the caller's language, then id (the database collation is approximated).
 */
function walkInBranchList(db: MockState, a: MedicalAccess) {
  const nameOf = (b: { nameAr: string; nameEn: string }) =>
    a.member.preferredLanguage === "ar" ? b.nameAr : b.nameEn;
  return db.branches
    .filter((b) => b.clinicId === a.clinic.id && b.isActive && worksIn(a, b.id))
    .sort((x, y) => nameOf(x).localeCompare(nameOf(y)) || (x.id < y.id ? -1 : 1))
    .map((b) => ({ id: b.id, nameAr: b.nameAr, nameEn: b.nameEn }));
}

/** The walk-in picker (R3-1): the caller's branches, then a branch's active files by name or number. */
export function createMockMedicalWalkIn(): Pick<MedicalApi, "walkInBranches" | "walkInCandidates"> {
  return {
    async walkInBranches(persona) {
      await delay(60);
      const db = getState();
      const a = requireKey(db, persona, "create", "visits", ["own"]);
      return { items: walkInBranchList(db, a) };
    },

    async walkInCandidates(persona, rawInput) {
      await delay();
      const db = getState();
      const a = requireKey(db, persona, "create", "visits", ["own"]);
      const input = parse(walkInSearchSchema, rawInput);
      if (!worksIn(a, input.branchId)) throw new ApiError("forbidden");
      requireOpenBranch(db, a, input.branchId);
      // As the API's query: the name contains the query (ILIKE, no letter folding), or its digits
      // (Arabic-Indic folded) are inside the padded file number; by name then number (the collation is
      // approximated), at most 20.
      const needle = input.q.toLocaleLowerCase();
      const digits = searchDigits(input.q);
      const items = db.patients
        .filter(
          (p) =>
            p.clinicId === a.clinic.id &&
            p.status === "active" &&
            p.registrationBranchId === input.branchId &&
            (p.fullName.toLocaleLowerCase().includes(needle) ||
              (digits !== "" && fileNumberMatches(p.fileNumber, digits))),
        )
        .sort((x, y) => x.fullName.localeCompare(y.fullName) || x.fileNumber - y.fileNumber)
        .slice(0, 20)
        .map((p) => ({ patientId: p.id, fullName: p.fullName, fileNumber: p.fileNumber }));
      // As the API's row: about no single record (the branch is not its entity).
      auditMedical(db, a, "visit", "visit.walk_in_searched", null);
      persist();
      return { items };
    },
  };
}
