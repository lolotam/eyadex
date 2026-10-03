import {
  normalizeKuwaitPhone,
  patientBranchActionSchema,
  patientInputSchema,
  patientListQuerySchema,
  type Patient,
  type PatientInput,
} from "@eyadex/contracts/patients";
import type { ApiClient } from "../api-client";
import { ApiError } from "../api-error";
import { writeClinicAudit } from "./mock-audit";
import {
  authorizePatients,
  enforceBirthDate,
  enforceCivilIdFree,
  guardPatients,
  writeResult,
  enforcePhoneFree,
  enforceRegistrationBranch,
  findPatientInScope,
  inScope,
  matchesSearch,
  patientSnapshot,
  toDetail,
  toListItem,
  type PatientAccess,
} from "./mock-patient-rules";
import { delay, getState, newId, persist, type MockState } from "./mock-store";

function parseInput(raw: PatientInput): PatientInput & { phone: string } {
  const result = patientInputSchema.safeParse(raw);
  if (!result.success) throw new ApiError("validation");
  const phone = normalizeKuwaitPhone(result.data.phone);
  if (!phone) throw new ApiError("validation");
  return { ...result.data, phone };
}

function audit(
  db: MockState,
  access: PatientAccess,
  action: string,
  before: Patient | null,
  after: Patient | null,
) {
  writeClinicAudit(db, {
    clinicId: access.clinic.id,
    actorName: access.actorName,
    action,
    entity: "patient",
    before: before ? patientSnapshot(before) : null,
    after: after ? patientSnapshot(after) : null,
  });
}

export function createMockPatients(): ApiClient["patients"] {
  async function setStatus(
    persona: Parameters<ApiClient["patients"]["archive"]>[0],
    patientId: string,
    status: Patient["status"],
  ) {
    await delay();
    const db = getState();
    const access = authorizePatients(db, persona, "deactivate");
    const patient = findPatientInScope(db, access, patientId);
    if (patient.status === status) return writeResult(db, persona, patient);
    const before = { ...patient };
    patient.status = status;
    audit(
      db,
      access,
      status === "archived" ? "patient.archived" : "patient.restored",
      before,
      patient,
    );
    persist();
    return writeResult(db, persona, patient);
  }

  return {
    async list(persona, rawQuery) {
      await delay();
      const db = getState();
      const access = authorizePatients(db, persona, "view");
      const parsed = patientListQuerySchema.safeParse(rawQuery);
      if (!parsed.success) throw new ApiError("validation");
      const query = parsed.data;
      const filtered = db.patients
        .filter((p) => p.clinicId === access.clinic.id && inScope(access, p.registrationBranchId))
        .filter((p) => !query.branchId || p.registrationBranchId === query.branchId)
        .filter((p) => !query.status || p.status === query.status)
        .filter((p) => matchesSearch(p, query.q))
        .sort((a, b) => b.fileNumber - a.fileNumber);
      const start = query.cursor ? filtered.findIndex((p) => p.id === query.cursor) + 1 : 0;
      const page = filtered.slice(start, start + query.limit);
      const last = page.at(-1);
      return {
        items: page.map((p) => toListItem(db, persona, p)),
        total: filtered.length,
        nextCursor: start + query.limit < filtered.length && last ? last.id : null,
      };
    },

    async branchOptions(persona, rawAction) {
      await delay();
      const db = getState();
      guardPatients(db, persona);
      const action = patientBranchActionSchema.safeParse(rawAction);
      if (!action.success) throw new ApiError("validation");
      const access = authorizePatients(db, persona, action.data);
      return db.branches
        .filter((b) => b.clinicId === access.clinic.id && inScope(access, b.id))
        .map((b) => ({ id: b.id, nameAr: b.nameAr, nameEn: b.nameEn, isActive: b.isActive }));
    },

    async open(persona, patientId) {
      await delay();
      const db = getState();
      const access = authorizePatients(db, persona, "view");
      const patient = findPatientInScope(db, access, patientId);
      // Every open of a file is patient access and is audited (PRD 4.11).
      writeClinicAudit(db, {
        clinicId: access.clinic.id,
        actorName: access.actorName,
        action: "patient.opened",
        entity: "patient",
        before: null,
        after: { id: patient.id, fileNumber: patient.fileNumber },
      });
      persist();
      return toDetail(db, persona, patient);
    },

    async create(persona, rawInput, idempotencyKey) {
      await delay();
      const db = getState();
      const access = authorizePatients(db, persona, "create");
      const input = parseInput(rawInput);
      enforceBirthDate(access, input.birthDate);
      const replayKey = `${access.clinic.id}:${idempotencyKey}`;
      const fingerprint = JSON.stringify({ ...input, civilId: input.civilId || null });
      const previous = db.idempotentPatients?.[replayKey];
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new ApiError("idempotency_conflict");
        // A replay needs the same create scope as the original call (scope can change since);
        // the file itself comes back only if the caller may also view it.
        const replayed = db.patients.find((p) => p.id === previous.patientId);
        if (!replayed || !inScope(access, replayed.registrationBranchId))
          throw new ApiError("not_found");
        return writeResult(db, persona, replayed);
      }
      enforceRegistrationBranch(db, access, input.registrationBranchId);
      enforcePhoneFree(db, persona, access.clinic.id, input.phone, null);
      enforceCivilIdFree(db, persona, access.clinic.id, input.civilId || null, null);
      const fileNumber = (db.patientCounters[access.clinic.id] ?? 0) + 1;
      db.patientCounters[access.clinic.id] = fileNumber;
      const patient: Patient = {
        id: newId(),
        clinicId: access.clinic.id,
        fileNumber,
        fullName: input.fullName,
        phone: input.phone,
        birthDate: input.birthDate,
        gender: input.gender,
        registrationBranchId: input.registrationBranchId,
        civilId: input.civilId || null,
        status: "active",
        createdAt: new Date().toISOString(),
      };
      db.patients.push(patient);
      db.idempotentPatients = {
        ...db.idempotentPatients,
        [replayKey]: { patientId: patient.id, fingerprint },
      };
      audit(db, access, "patient.created", null, patient);
      persist();
      return writeResult(db, persona, patient);
    },

    async update(persona, patientId, rawInput) {
      await delay();
      const db = getState();
      const access = authorizePatients(db, persona, "update");
      const input = parseInput(rawInput);
      enforceBirthDate(access, input.birthDate);
      const patient = findPatientInScope(db, access, patientId);
      if (input.registrationBranchId !== patient.registrationBranchId)
        enforceRegistrationBranch(db, access, input.registrationBranchId);
      enforcePhoneFree(db, persona, access.clinic.id, input.phone, patient.id);
      enforceCivilIdFree(db, persona, access.clinic.id, input.civilId || null, patient.id);
      const before = { ...patient };
      Object.assign(patient, {
        fullName: input.fullName,
        phone: input.phone,
        birthDate: input.birthDate,
        gender: input.gender,
        registrationBranchId: input.registrationBranchId,
        civilId: input.civilId || null,
      });
      audit(db, access, "patient.updated", before, patient);
      persist();
      return writeResult(db, persona, patient);
    },

    archive: (persona, patientId) => setStatus(persona, patientId, "archived"),
    restore: (persona, patientId) => setStatus(persona, patientId, "active"),
  };
}
