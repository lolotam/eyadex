import { beforeEach, describe, expect, it } from "vitest";
import { as, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { api, doctorAt, file, getState, startDraft } from "./medical-test-kit";

// P2 spec §5: medical audit rows carry field names only — never clinical text, a code, a medicine
// name, a search query or a civil ID — and are patient access except the medicines list.
const SECRETS = [
  "Sudden chest tightness",
  "F41.1",
  "Generalized anxiety",
  "Rarecillin 250 mg",
  "zebra-query",
  "Penicillin allergy",
  "Remember the follow-up call",
  "lab-result.pdf",
];

beforeEach(() => resetMockData());

describe("the medical mock audit", () => {
  it("keeps clinical text, codes, medicine names and queries out of every row", async () => {
    const D = doctorAt(0);
    const { visit } = await startDraft();
    await api.medical.saveNote(D, visit.id, {
      complaint: SECRETS[0]!,
      examination: null,
      assessment: null,
      plan: null,
    });
    await api.medical.saveDiagnoses(D, visit.id, {
      items: [{ kind: "icd10", code: "F41.1", text: "Generalized anxiety disorder" }],
    });
    await api.medical.savePrescription(D, visit.id, {
      items: [
        { medicine: SECRETS[3]!, dose: "1", frequency: "daily", duration: "1 week", note: null },
      ],
    });
    await api.medical.signVisit(D, visit.id);
    await api.medical.addAddendum(D, visit.id, { body: SECRETS[6]! });
    await api.medical.searchVisits(D, visit.patientId, { q: SECRETS[4]! });
    await api.medical.saveMedicalProfile(D, visit.patientId, {
      allergies: SECRETS[5]!,
      chronicConditions: null,
      currentMedications: null,
      surgicalHistory: null,
      familyHistory: null,
    });
    await api.medical.uploadAttachment(
      D,
      visit.patientId,
      file("application/pdf", 50, SECRETS[7]),
      null,
    );
    await api.medical.getPrescriptionPrint(D, visit.id);
    await api.medical.createMedicine(
      as("clinic_admin"),
      { name: SECRETS[3]!, defaultDose: null, defaultFrequency: null },
      crypto.randomUUID(),
    );
    const rows = JSON.stringify(getState().clinicAudit);
    for (const secret of SECRETS) expect(rows).not.toContain(secret);
    for (const civil of getState()
      .patients.map((p) => p.civilId)
      .filter(Boolean)) {
      expect(rows).not.toContain(civil!);
    }
  });

  it("is patient access for medical entities and administrative for medicines", async () => {
    await startDraft();
    await api.medical.createMedicine(
      as("clinic_admin"),
      { name: "Testamine", defaultDose: null, defaultFrequency: null },
      crypto.randomUUID(),
    );
    const rows = getState().clinicAudit;
    expect(rows.find((r) => r.action === "visit.started")?.category).toBe("patient_access");
    expect(rows.find((r) => r.action === "medicine.created")?.category).toBe("administrative");
    expect(rows.find((r) => r.action === "visit.started")?.after).toMatchObject({ fields: [] });
  });

  it("an identical note save answers the note, so it is logged as an open", async () => {
    const D = doctorAt(0);
    const { visit } = await startDraft();
    const note = { complaint: "A", examination: null, assessment: null, plan: null };
    await api.medical.saveNote(D, visit.id, note);
    const before = getState().clinicAudit.length;
    await api.medical.saveNote(D, visit.id, note);
    const added = getState().clinicAudit.slice(0, getState().clinicAudit.length - before);
    expect(added.map((r) => [r.action, r.category])).toEqual([["visit.opened", "patient_access"]]);
  });

  it("listing attachments shows their names, so it is logged once, without a name", async () => {
    const D = doctorAt(0);
    const { visit } = await startDraft();
    await api.medical.uploadAttachment(D, visit.patientId, file("image/png", 50, SECRETS[7]), null);
    const before = getState().clinicAudit.length;
    await api.medical.listAttachments(D, visit.patientId, {});
    const added = getState().clinicAudit.slice(0, getState().clinicAudit.length - before);
    expect(added.map((r) => [r.action, r.category, r.entityId])).toEqual([
      ["attachment.listed", "patient_access", visit.patientId],
    ]);
    expect(JSON.stringify(added)).not.toContain(SECRETS[7]);
  });
});
