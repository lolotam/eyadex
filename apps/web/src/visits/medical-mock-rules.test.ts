import { beforeEach, describe, expect, it } from "vitest";
import { ATTACHMENT_MAX_BYTES } from "@eyadex/contracts/attachments";
import { as, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { api, doctorAt, file, getState, ownAppointment, startDraft } from "./medical-test-kit";

// P2 brief §2: the mock enforces the API's rules, one test per error code.
const D = () => doctorAt(0);
const reject = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });

beforeEach(() => resetMockData());

describe("the medical mock rules", () => {
  it("module_disabled while the clinic's medical module is off", async () => {
    getState().features[getState().clinics[0]!.id]!.medical = false;
    await reject(api.medical.walkInBranches(D()), "module_disabled");
  });

  it("appointment_not_arrived: a visit starts only once the patient has arrived", async () => {
    const appt = ownAppointment("booked");
    await reject(
      api.medical.startVisit(D(), { appointmentId: appt.id }, crypto.randomUUID()),
      "appointment_not_arrived",
    );
  });

  it("visit_exists with details.visitId: one live visit per appointment", async () => {
    const first = await startDraft();
    const appt = getState().appointments.find((a) => a.id === first.visit.appointmentId)!;
    await expect(
      api.medical.startVisit(D(), { appointmentId: appt.id }, crypto.randomUUID()),
    ).rejects.toMatchObject({ code: "visit_exists", details: { visitId: first.visit.id } });
  });

  it("a retry with the same key replays the first visit", async () => {
    const appt = ownAppointment("arrived");
    const key = crypto.randomUUID();
    const a = await api.medical.startVisit(D(), { appointmentId: appt.id }, key);
    const b = await api.medical.startVisit(D(), { appointmentId: appt.id }, key);
    expect(b.visit.id).toBe(a.visit.id);
  });

  it("visit_empty: signing needs a note section or a diagnosis", async () => {
    const { visit } = await startDraft();
    await reject(api.medical.signVisit(D(), visit.id), "visit_empty");
    await api.medical.saveNote(D(), visit.id, {
      complaint: "Headache",
      examination: null,
      assessment: null,
      plan: null,
    });
    expect((await api.medical.signVisit(D(), visit.id)).visit.status).toBe("signed");
  });

  it("can.sign follows visit_empty: an empty draft is not offered Sign, a saved note is", async () => {
    const { visit } = await startDraft();
    expect((await api.medical.getVisit(D(), visit.id)).can.sign).toBe(false);
    const note = { complaint: "Headache", examination: null, assessment: null, plan: null };
    expect((await api.medical.saveNote(D(), visit.id, note)).can.sign).toBe(true);
  });

  it("patient_inactive, branch_inactive: an appointment of an archived file or a closed branch", async () => {
    const appt = ownAppointment("arrived");
    const db = getState();
    const before = db.medical.visits.length;
    const start = () =>
      api.medical.startVisit(D(), { appointmentId: appt.id }, crypto.randomUUID());
    const patient = db.patients.find((p) => p.id === appt.patientId)!;
    patient.status = "archived";
    await reject(start(), "patient_inactive");
    patient.status = "active";
    db.branches.find((b) => b.id === appt.branchId)!.isActive = false;
    await reject(start(), "branch_inactive");
    expect(getState().medical.visits).toHaveLength(before);
  });

  it("patient_inactive: an archived file offers no medical file edit and refuses the save", async () => {
    const { visit } = await startDraft();
    const patient = getState().patients.find((p) => p.id === visit.patientId)!;
    expect((await api.medical.getMedicalProfile(D(), patient.id)).can.update).toBe(true);
    patient.status = "archived";
    expect((await api.medical.getMedicalProfile(D(), patient.id)).can.update).toBe(false);
    const profile = {
      allergies: "Penicillin",
      chronicConditions: null,
      currentMedications: null,
      surgicalHistory: null,
      familyHistory: null,
    };
    await reject(api.medical.saveMedicalProfile(D(), patient.id, profile), "patient_inactive");
  });

  it("patient_inactive: an archived file takes no upload, checked before the bytes", async () => {
    const { visit } = await startDraft();
    const patient = getState().patients.find((p) => p.id === visit.patientId)!;
    patient.status = "archived";
    for (const sent of [file("image/png", 100), file("text/plain", 10)]) {
      await reject(
        api.medical.uploadAttachment(D(), patient.id, sent, visit.id),
        "patient_inactive",
      );
    }
    expect(getState().medical.attachments.filter((x) => x.patientId === patient.id)).toEqual([]);
  });

  it("can.attach follows the upload rule: a signed visit takes one, an archived file none", async () => {
    const { visit } = await startDraft();
    const note = { complaint: "A", examination: null, assessment: null, plan: null };
    await api.medical.saveNote(D(), visit.id, note);
    const signed = await api.medical.signVisit(D(), visit.id);
    expect([signed.can.edit, signed.can.attach]).toEqual([false, true]);
    getState().patients.find((p) => p.id === visit.patientId)!.status = "archived";
    expect((await api.medical.getVisit(D(), visit.id)).can.attach).toBe(false);
  });

  it("visit_signed: a signed note never changes", async () => {
    const { visit } = await startDraft();
    const note = { complaint: "A", examination: null, assessment: null, plan: null };
    await api.medical.saveNote(D(), visit.id, note);
    await api.medical.signVisit(D(), visit.id);
    await reject(api.medical.saveNote(D(), visit.id, { ...note, complaint: "B" }), "visit_signed");
    await reject(api.medical.saveDiagnoses(D(), visit.id, { items: [] }), "visit_signed");
    await reject(
      api.medical.cancelVisit(D(), visit.id, { reason: "other", note: null }),
      "visit_signed",
    );
  });

  it("visit_not_signed: addenda only on a signed visit", async () => {
    const { visit } = await startDraft();
    await reject(api.medical.addAddendum(D(), visit.id, { body: "Later" }), "visit_not_signed");
  });

  it("visit_not_provider: only the visit's provider writes", async () => {
    const { visit } = await startDraft(0);
    // A second doctor holding update:medical:clinic reads it but cannot write it.
    const other = doctorAt(1);
    const role = getState().roles.find(
      (r) => r.id === getState().members.find((m) => m.id === other.memberId)!.roleId,
    )!;
    role.permissions.push(
      "view:patients:clinic",
      "view:visits:clinic",
      "view:medical:clinic",
      "update:medical:clinic",
    );
    const note = { complaint: "X", examination: null, assessment: null, plan: null };
    await reject(api.medical.saveNote(other, visit.id, note), "visit_not_provider");
    expect((await api.medical.getVisit(other, visit.id)).can.edit).toBe(false);
  });

  it("removed diagnoses are archived and never shown again", async () => {
    const { visit } = await startDraft();
    await api.medical.saveDiagnoses(D(), visit.id, {
      items: [
        { kind: "text", text: "First" },
        { kind: "icd10", code: "F41.1", text: "GAD" },
      ],
    });
    const after = await api.medical.saveDiagnoses(D(), visit.id, {
      items: [{ kind: "text", text: "Second" }],
    });
    expect(after.content?.diagnoses.map((d) => d.text)).toEqual(["Second"]);
    const stored = getState().medical.visits.find((v) => v.id === visit.id)!;
    expect(stored.diagnoses.filter((d) => d.archived)).toHaveLength(2);
  });

  it("icd10_unknown: a code outside the list is refused", async () => {
    const { visit } = await startDraft();
    await reject(
      api.medical.saveDiagnoses(D(), visit.id, {
        items: [{ kind: "icd10", code: "Z99.99", text: "Nope" }],
      }),
      "icd10_unknown",
    );
  });

  it("the front desk sees that a visit exists, never its content (P2-K4)", async () => {
    const { visit } = await startDraft();
    // A front-desk account working in the visit's branch (view:visits:branch).
    const db = getState();
    const deskRole = db.roles.find(
      (r) => r.clinicId === db.clinics[0]!.id && r.systemKey === "receptionist",
    )!;
    for (const m of db.members) if (m.roleId === deskRole.id) m.allBranches = true;
    const desk = await api.medical.getVisit(as("receptionist"), visit.id);
    expect(desk.content).toBeNull();
    await reject(api.medical.getMedicalProfile(as("receptionist"), visit.patientId), "forbidden");
  });

  it("the locked admin holds visits but not the clinical content (P2-5)", async () => {
    const { visit } = await startDraft();
    expect((await api.medical.getVisit(as("clinic_admin"), visit.id)).content).toBeNull();
  });

  it("not_found: another doctor's patient under own", async () => {
    const { visit } = await startDraft(0);
    await reject(api.medical.getVisit(doctorAt(1), visit.id), "not_found");
  });

  it("medicine_name_taken: names are unique in the clinic list", async () => {
    const admin = as("clinic_admin");
    const input = { name: "Testamine 5 mg", defaultDose: null, defaultFrequency: null };
    await api.medical.createMedicine(admin, input, crypto.randomUUID());
    await reject(
      api.medical.createMedicine(admin, { ...input, name: "testamine 5 MG" }, crypto.randomUUID()),
      "medicine_name_taken",
    );
  });

  it("attachment_type, attachment_too_large and attachment_patient_mismatch", async () => {
    const { visit } = await startDraft();
    const other = getState().patients.find(
      (p) => p.clinicId === getState().clinics[0]!.id && p.id !== visit.patientId,
    )!;
    await reject(
      api.medical.uploadAttachment(D(), visit.patientId, file("text/plain", 10), null),
      "attachment_type",
    );
    await reject(
      api.medical.uploadAttachment(
        D(),
        visit.patientId,
        file("image/png", ATTACHMENT_MAX_BYTES + 1),
        null,
      ),
      "attachment_too_large",
    );
    // The doctor reaches `other` once it has a visit with them; the visit still belongs to the first.
    getState().medical.visits.push({
      ...getState().medical.visits.find((v) => v.id === visit.id)!,
      id: crypto.randomUUID(),
      patientId: other.id,
      appointmentId: null,
    });
    await reject(
      api.medical.uploadAttachment(D(), other.id, file("image/png", 100), visit.id),
      "attachment_patient_mismatch",
    );
    await api.medical.uploadAttachment(D(), visit.patientId, file("image/png", 100), visit.id);
    const list = await api.medical.listAttachments(D(), visit.patientId, { visitId: visit.id });
    expect(list.items).toHaveLength(1);
  });

  it("walk-in candidates: active files of the branch only, at most 20, name and number", async () => {
    const { items: branches } = await api.medical.walkInBranches(D());
    const branchId = branches[0]!.id;
    const { items } = await api.medical.walkInCandidates(D(), { branchId, q: "al" });
    expect(items.length).toBeLessThanOrEqual(20);
    for (const c of items) {
      const p = getState().patients.find((x) => x.id === c.patientId)!;
      expect(p.status).toBe("active");
      expect(p.registrationBranchId).toBe(branchId);
      expect(Object.keys(c).sort()).toEqual(["fileNumber", "fullName", "patientId"]);
    }
  });

  it("a walk-in starts only for a file registered in that branch (Codex PR #68)", async () => {
    const { items: branches } = await api.medical.walkInBranches(D());
    const branchId = branches[0]!.id;
    const clinicId = getState().clinics[0]!.id;
    const elsewhere = getState().patients.find(
      (p) =>
        p.clinicId === clinicId && p.status === "active" && p.registrationBranchId !== branchId,
    )!;
    const before = getState().medical.visits.length;
    await reject(
      api.medical.startVisit(D(), { patientId: elsewhere.id, branchId }, crypto.randomUUID()),
      "not_found",
    );
    expect(getState().medical.visits).toHaveLength(before);
  });

  it("role_self_change: nobody changes their own role", async () => {
    const admin = as("clinic_admin");
    const db = getState();
    const clinicId = db.clinics[0]!.id;
    const adminRole = db.roles.find(
      (r) => r.clinicId === clinicId && r.systemKey === "clinic_admin",
    )!;
    const me = db.members.find((m) => m.clinicId === clinicId && m.roleId === adminRole.id)!;
    // A second active admin, so the last-admin rule does not answer first.
    db.members.push({ ...me, id: crypto.randomUUID(), userId: crypto.randomUUID() });
    const doctorRole = db.roles.find((r) => r.clinicId === clinicId && r.systemKey === "doctor")!;
    await reject(
      api.users.changeRole({ ...admin, memberId: me.id }, me.id, { roleId: doctorRole.id }),
      "role_self_change",
    );
  });
});
