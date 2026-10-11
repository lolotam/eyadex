import { beforeEach, describe, expect, it } from "vitest";
import { as, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { api, doctorAt, file, getState, ownAppointment, startDraft } from "./medical-test-kit";

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
    expect(rows.find((r) => r.action === "visit.started")?.after).toEqual({ changed: ["status"] });
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

  it("a start replayed with its key answers the note, so it is logged as an open", async () => {
    const D = doctorAt(0);
    const key = crypto.randomUUID();
    const body = { appointmentId: ownAppointment().id };
    const { visit } = await api.medical.startVisit(D, body, key);
    const note = { complaint: SECRETS[0]!, examination: null, assessment: null, plan: null };
    await api.medical.saveNote(D, visit.id, note);
    const before = getState().clinicAudit.length;
    const replay = await api.medical.startVisit(D, body, key);
    expect(replay.content?.note.complaint).toBe(SECRETS[0]);
    const added = getState().clinicAudit.slice(0, getState().clinicAudit.length - before);
    expect(added.map((r) => [r.action, r.entityId])).toEqual([["visit.opened", visit.id]]);
    expect(JSON.stringify(added)).not.toContain(SECRETS[0]);
  });

  it("archiving an archived attachment is not_found and logs nothing more", async () => {
    const D = doctorAt(0);
    const { visit } = await startDraft();
    const up = await api.medical.uploadAttachment(D, visit.patientId, file("image/png", 50), null);
    await api.medical.archiveAttachment(D, up.attachment.id);
    const before = getState().clinicAudit.length;
    await expect(api.medical.archiveAttachment(D, up.attachment.id)).rejects.toMatchObject({
      code: "not_found",
    });
    expect(getState().clinicAudit.length).toBe(before);
  });

  it("an identical profile save keeps the profile and is logged as an open, like the API", async () => {
    const D = doctorAt(0);
    const { visit } = await startDraft();
    const profile = {
      allergies: SECRETS[5]!,
      chronicConditions: null,
      currentMedications: null,
      surgicalHistory: null,
      familyHistory: null,
    };
    await api.medical.saveMedicalProfile(D, visit.patientId, profile);
    expect(getState().clinicAudit[0]?.action).toBe("medical_profile.saved");
    const row = getState().medical.profiles.find((p) => p.patientId === visit.patientId)!;
    row.updatedAt = "2026-01-01T00:00:00.000Z";
    row.updatedByName = "Earlier author";
    const before = getState().clinicAudit.length;
    const again = await api.medical.saveMedicalProfile(D, visit.patientId, profile);
    expect([again.updatedAt, again.updatedByName]).toEqual([row.updatedAt, "Earlier author"]);
    const added = getState().clinicAudit.slice(0, getState().clinicAudit.length - before);
    expect(added.map((r) => [r.action, r.category, r.entityId])).toEqual([
      ["medical_profile.opened", "patient_access", visit.patientId],
    ]);
  });

  it("opening a visit without the content key logs no open: nothing clinical was answered", async () => {
    const { visit } = await startDraft();
    const before = getState().clinicAudit.length;
    const admin = await api.medical.getVisit(as("clinic_admin"), visit.id);
    expect(admin.content).toBeNull();
    expect(getState().clinicAudit.length).toBe(before);
    await api.medical.getVisit(doctorAt(0), visit.id);
    const added = getState().clinicAudit.slice(0, getState().clinicAudit.length - before);
    expect(added.map((r) => [r.action, r.entityId])).toEqual([["visit.opened", visit.id]]);
  });
});

// A read records only who, what and when: the API's `auditMedical` without `changed` stores
// `{ before: null, after: null }` (field names exist only on writes, R3-4).
describe("the mock's medical read rows, as the API's", () => {
  type Draft = Awaited<ReturnType<typeof startDraft>>;
  const D = () => doctorAt(0);
  it.each<[string, (d: Draft) => Promise<unknown>]>([
    ["visit.opened", ({ visit }) => api.medical.getVisit(D(), visit.id)],
    ["visit.searched", ({ visit }) => api.medical.searchVisits(D(), visit.patientId, { q: "a" })],
    ["visit.previews_listed", ({ visit }) => api.medical.listVisits(D(), visit.patientId, {})],
    [
      "visit.walk_in_searched",
      async () => {
        const { items } = await api.medical.walkInBranches(D());
        return api.medical.walkInCandidates(D(), { branchId: items[0]!.id, q: "al" });
      },
    ],
    ["medical_profile.opened", ({ visit }) => api.medical.getMedicalProfile(D(), visit.patientId)],
    ["attachment.listed", ({ visit }) => api.medical.listAttachments(D(), visit.patientId, {})],
    [
      "attachment.downloaded",
      async ({ visit }) => {
        const up = await api.medical.uploadAttachment(
          D(),
          visit.patientId,
          file("image/png", 50),
          null,
        );
        return api.medical.downloadAttachment(D(), up.attachment.id);
      },
    ],
    ["visit.prescription_printed", ({ visit }) => api.medical.getPrescriptionPrint(D(), visit.id)],
  ])("%s carries no snapshot", async (action, read) => {
    const draft = await startDraft();
    const note = { complaint: "Headache", examination: null, assessment: "a", plan: null };
    await api.medical.saveNote(D(), draft.visit.id, note);
    await read(draft);
    const row = getState().clinicAudit.find((r) => r.action === action)!;
    expect([row.before, row.after]).toEqual([null, null]);
  });
});
