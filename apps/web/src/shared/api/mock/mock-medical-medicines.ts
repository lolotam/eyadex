import {
  medicineInputSchema,
  type Medicine,
  type MedicineInput,
} from "@eyadex/contracts/medicines";
import type { Persona } from "@eyadex/contracts/session";
import { ApiError } from "../api-error";
import type { MedicalApi } from "../medical-client";
import { actorReplayKey, requireIdempotencyKey } from "./mock-idempotency";
import { parse, requireKey, type MedicalAccess } from "./mock-medical-access";
import { auditMedical } from "./mock-medical-project";
import type { StoredMedicine } from "./mock-medical-state";
import { delay, getState, newId, persist, type MockState } from "./mock-store";

// The clinic's frequent medicines (P2-F2): administrative, not patient data. Its audit rows carry
// field names and the status only, never a medicine's name.

const view = ({ clinicId: _clinic, ...rest }: StoredMedicine): Medicine => rest;

function find(db: MockState, a: MedicalAccess, id: string): StoredMedicine {
  const row = db.medical.medicines.find((m) => m.clinicId === a.clinic.id && m.id === id);
  if (!row) throw new ApiError("not_found");
  return row;
}

function enforceUniqueName(db: MockState, a: MedicalAccess, name: string, exceptId?: string) {
  const wanted = name.toLocaleLowerCase();
  const taken = db.medical.medicines.some(
    (m) => m.clinicId === a.clinic.id && m.id !== exceptId && m.name.toLocaleLowerCase() === wanted,
  );
  if (taken) throw new ApiError("medicine_name_taken");
}

// The API's `fieldsOf`: a blank default is no default.
const blankAsNull = (text: string | null) => (text === null || text.trim() === "" ? null : text);
const FIELDS = ["name", "defaultDose", "defaultFrequency"] as const;
const fieldsOf = (input: MedicineInput): MedicineInput => ({
  name: input.name,
  defaultDose: blankAsNull(input.defaultDose),
  defaultFrequency: blankAsNull(input.defaultFrequency),
});

const writer = (persona: Persona) =>
  requireKey(getState(), persona, "update", "medicines", ["clinic"]);

async function setStatus(persona: Persona, id: string, status: StoredMedicine["status"]) {
  await delay();
  const db = getState();
  const a = writer(persona);
  const row = find(db, a, id);
  if (row.status !== status) {
    row.status = status;
    const action = status === "active" ? "medicine.reactivated" : "medicine.deactivated";
    auditMedical(db, a, "medicine", action, row.id, ["status"]);
    persist();
  }
  return view(row);
}

export function createMockMedicalMedicines(): Pick<
  MedicalApi,
  | "listMedicines"
  | "createMedicine"
  | "updateMedicine"
  | "deactivateMedicine"
  | "reactivateMedicine"
> {
  return {
    async listMedicines(persona) {
      await delay(80);
      const db = getState();
      const a = requireKey(db, persona, "view", "medicines", ["clinic"]);
      const items = db.medical.medicines
        .filter((m) => m.clinicId === a.clinic.id)
        .sort(
          (x, y) =>
            Number(y.status === "active") - Number(x.status === "active") ||
            x.name.localeCompare(y.name),
        )
        .map(view);
      return { items };
    },

    async createMedicine(persona, rawInput, idempotencyKey) {
      await delay();
      const db = getState();
      // The API's order: the guard, the body, then the key (`keyOf`).
      const a = writer(persona);
      const input = parse(medicineInputSchema, rawInput);
      const key = requireIdempotencyKey(idempotencyKey);
      const replayKey = actorReplayKey(a.clinic.id, a.member.id, key);
      const fingerprint = JSON.stringify(input);
      const previous = db.medical.idempotentMedicines[replayKey];
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new ApiError("idempotency_conflict");
        const replayed = db.medical.medicines.find((m) => m.id === previous.medicineId);
        if (replayed) return view(replayed);
      }
      enforceUniqueName(db, a, input.name);
      const row: StoredMedicine = {
        id: newId(),
        clinicId: a.clinic.id,
        ...fieldsOf(input),
        status: "active",
      };
      db.medical.medicines.push(row);
      db.medical.idempotentMedicines[replayKey] = { medicineId: row.id, fingerprint };
      const filled = FIELDS.filter((f) => row[f] !== null);
      auditMedical(db, a, "medicine", "medicine.created", row.id, filled);
      persist();
      return view(row);
    },

    async updateMedicine(persona, id, rawInput) {
      await delay();
      const db = getState();
      const a = writer(persona);
      const input = fieldsOf(parse(medicineInputSchema, rawInput));
      const row = find(db, a, id);
      const changed = FIELDS.filter((f) => row[f] !== input[f]);
      // As the API: an unchanged save answers the row as it stands, with no audit row.
      if (changed.length === 0) return view(row);
      enforceUniqueName(db, a, input.name, row.id);
      Object.assign(row, input);
      auditMedical(db, a, "medicine", "medicine.updated", row.id, changed);
      persist();
      return view(row);
    },

    deactivateMedicine: (persona, id) => setStatus(persona, id, "inactive"),
    reactivateMedicine: (persona, id) => setStatus(persona, id, "active"),
  };
}
