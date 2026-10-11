import { icd10QuerySchema } from "@eyadex/contracts/icd10";
import {
  medicalProfileInputSchema,
  type MedicalProfile,
  type MedicalProfileInput,
} from "@eyadex/contracts/medical-profile";
import { ApiError } from "../api-error";
import type { MedicalApi } from "../medical-client";
import { ICD10_RELEASE, searchIcd10Demo } from "./mock-icd10-list";
import {
  contentFile,
  parse,
  patientOf,
  reachesContent,
  requireKey,
  seesVisit,
  visibleVisit,
  type MedicalAccess,
} from "./mock-medical-access";
import { auditMedical } from "./mock-medical-project";
import { delay, getState, persist, type MockState } from "./mock-store";

const PROFILE_FIELDS = [
  "allergies",
  "chronicConditions",
  "currentMedications",
  "surgicalHistory",
  "familyHistory",
] as const;

function profileOf(db: MockState, a: MedicalAccess, patientId: string): MedicalProfile {
  const row = db.medical.profiles.find(
    (p) => p.clinicId === a.clinic.id && p.patientId === patientId,
  );
  const profile = Object.fromEntries(PROFILE_FIELDS.map((f) => [f, row?.[f] ?? null]));
  return {
    profile: profile as MedicalProfile["profile"],
    updatedAt: row?.updatedAt ?? null,
    // As the API: the author's current name, looked up on every read.
    updatedByName: row ? (db.members.find((m) => m.id === row.updatedBy)?.fullName ?? null) : null,
    // An archived file is never written (`patient_inactive`), so it offers no edit (as the API).
    can: {
      update:
        patientOf(db, a, patientId).status === "active" &&
        reachesContent(db, a, "update", patientId),
    },
  };
}

export function createMockMedicalFiles(): Pick<
  MedicalApi,
  "getMedicalProfile" | "saveMedicalProfile" | "searchIcd10" | "getPrescriptionPrint"
> {
  return {
    async getMedicalProfile(persona, patientId) {
      await delay();
      const db = getState();
      const a = requireKey(db, persona, "view", "medical", ["clinic", "own"]);
      contentFile(db, a, "view", patientId);
      auditMedical(db, a, "medical_profile", "medical_profile.opened", patientId);
      persist();
      return profileOf(db, a, patientId);
    },

    async saveMedicalProfile(persona, patientId, rawInput: MedicalProfileInput) {
      await delay();
      const db = getState();
      const a = requireKey(db, persona, "update", "medical", ["clinic", "own"]);
      const input = parse(medicalProfileInputSchema, rawInput);
      const patient = contentFile(db, a, "update", patientId);
      if (patient.status !== "active") throw new ApiError("patient_inactive");
      const before = profileOf(db, a, patientId).profile;
      const next = Object.fromEntries(
        PROFILE_FIELDS.map((f) => [f, input[f] && input[f].length > 0 ? input[f] : null]),
      ) as MedicalProfile["profile"];
      const changed = PROFILE_FIELDS.filter((f) => before[f] !== next[f]);
      if (changed.length === 0) {
        // Nothing to write, but the answer carries the five sections: a read, logged like the API's.
        auditMedical(db, a, "medical_profile", "medical_profile.opened", patientId);
        persist();
        return profileOf(db, a, patientId);
      }
      db.medical.profiles = db.medical.profiles.filter(
        (p) => !(p.clinicId === a.clinic.id && p.patientId === patientId),
      );
      db.medical.profiles.push({
        clinicId: a.clinic.id,
        patientId,
        ...next,
        updatedAt: new Date().toISOString(),
        updatedBy: a.member.id,
      });
      auditMedical(db, a, "medical_profile", "medical_profile.saved", patientId, changed);
      persist();
      return profileOf(db, a, patientId);
    },

    async searchIcd10(persona, rawQ) {
      await delay(80);
      const db = getState();
      requireKey(db, persona, "view", "medical", ["clinic", "own"]);
      const { q } = parse(icd10QuerySchema, { q: rawQ });
      return { items: searchIcd10Demo(q), release: ICD10_RELEASE };
    },

    async getPrescriptionPrint(persona, visitId) {
      await delay();
      const db = getState();
      const a = requireKey(db, persona, "view", "medical", ["clinic", "own"]);
      const v = visibleVisit(db, a, visitId);
      if (!reachesContent(db, a, "view", v.patientId)) throw new ApiError("not_found");
      const patient = db.patients.find((p) => p.id === v.patientId);
      const branch = db.branches.find((b) => b.id === v.branchId);
      auditMedical(db, a, "prescription", "visit.prescription_printed", v.id);
      persist();
      return {
        clinic: { nameAr: a.clinic.nameAr, nameEn: a.clinic.nameEn },
        branch: { nameAr: branch?.nameAr ?? "", nameEn: branch?.nameEn ?? "" },
        patient: { fullName: patient?.fullName ?? "", fileNumber: patient?.fileNumber ?? 0 },
        providerName: db.members.find((m) => m.id === v.providerMembershipId)?.fullName ?? "",
        startedAt: v.startedAt,
        signedAt: v.signedAt,
        items: v.prescription
          .filter((p) => !p.archived)
          .map(({ archived: _archived, ...item }) => item),
      };
    },
  };
}
