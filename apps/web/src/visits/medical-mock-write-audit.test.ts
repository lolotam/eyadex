import { beforeEach, describe, expect, it } from "vitest";
import { as, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { api, doctorAt, file, getState, startDraft } from "./medical-test-kit";

// A medical write row is the API's `{ before: null, after: { changed } }`: the names of the fields the
// write changed, as the API computes them (R3-4), and nothing else.
beforeEach(() => resetMockData());

const D = () => doctorAt(0);
const NOTE = { complaint: "Headache", examination: null, assessment: null, plan: "Rest" };
const MEDICINE = { name: "Testamine", defaultDose: null, defaultFrequency: "daily" };

async function signedDraft() {
  const { visit } = await startDraft();
  await api.medical.saveNote(D(), visit.id, NOTE);
  await api.medical.signVisit(D(), visit.id);
  return visit;
}
const draftId = async () => (await startDraft()).visit.id;
const cancel = async (note: string | null) =>
  api.medical.cancelVisit(D(), await draftId(), { reason: "patient_left", note });
const medicine = () =>
  api.medical.createMedicine(as("clinic_admin"), MEDICINE, crypto.randomUUID());

describe("the mock's medical write rows, as the API's", () => {
  it.each<[string, string[], () => Promise<unknown>]>([
    ["visit.started", ["status"], () => startDraft()],
    [
      "visit.note_saved",
      ["complaint", "plan"],
      async () => api.medical.saveNote(D(), await draftId(), NOTE),
    ],
    [
      "visit.diagnoses_saved",
      ["items"],
      async () =>
        api.medical.saveDiagnoses(D(), await draftId(), {
          items: [{ kind: "text", text: "Migraine" }],
        }),
    ],
    [
      "visit.prescription_saved",
      ["items"],
      async () =>
        api.medical.savePrescription(D(), await draftId(), {
          items: [{ medicine: "P", dose: "1", frequency: "daily", duration: "3 days", note: null }],
        }),
    ],
    ["visit.signed", ["status"], signedDraft],
    ["visit.cancelled", ["status", "cancelReason"], () => cancel(null)],
    ["visit.cancelled", ["status", "cancelReason"], () => cancel("   ")],
    ["visit.cancelled", ["status", "cancelReason", "cancelNote"], () => cancel("wrong file")],
    [
      "visit.addendum_added",
      ["body"],
      async () => api.medical.addAddendum(D(), (await signedDraft()).id, { body: "Later" }),
    ],
    [
      "medical_profile.saved",
      ["allergies"],
      async () => {
        const { patientId } = (await startDraft()).visit;
        const profile = {
          allergies: "Penicillin",
          chronicConditions: "Asthma",
          currentMedications: null,
          surgicalHistory: null,
          familyHistory: null,
        };
        await api.medical.saveMedicalProfile(D(), patientId, profile);
        return api.medical.saveMedicalProfile(D(), patientId, { ...profile, allergies: "None" });
      },
    ],
    [
      "attachment.uploaded",
      ["file"],
      async () =>
        api.medical.uploadAttachment(
          D(),
          (await startDraft()).visit.patientId,
          file("image/png", 50),
          null,
        ),
    ],
    [
      "attachment.archived",
      ["status"],
      async () => {
        const { visit } = await startDraft();
        const up = await api.medical.uploadAttachment(
          D(),
          visit.patientId,
          file("image/png", 50),
          null,
        );
        return api.medical.archiveAttachment(D(), up.attachment.id);
      },
    ],
    ["medicine.created", ["name", "defaultFrequency"], medicine],
    [
      "medicine.updated",
      ["defaultDose"],
      async () =>
        api.medical.updateMedicine(as("clinic_admin"), (await medicine()).id, {
          ...MEDICINE,
          defaultDose: "500 mg",
        }),
    ],
    [
      "medicine.deactivated",
      ["status"],
      async () => api.medical.deactivateMedicine(as("clinic_admin"), (await medicine()).id),
    ],
    [
      "medicine.reactivated",
      ["status"],
      async () => {
        const { id } = await medicine();
        await api.medical.deactivateMedicine(as("clinic_admin"), id);
        return api.medical.reactivateMedicine(as("clinic_admin"), id);
      },
    ],
  ])("%s records changed = %j", async (action, changed, write) => {
    await write();
    const row = getState().clinicAudit.find((r) => r.action === action)!;
    expect({ before: row.before, after: row.after }).toEqual({ before: null, after: { changed } });
  });
});
