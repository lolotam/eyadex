import { beforeEach, describe, expect, it } from "vitest";
import type { Persona } from "@eyadex/contracts/session";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { api, doctorAt, doctorMember, file, getState, startDraft } from "./medical-test-kit";

// PR #68 review: the mock mirrors the API on an archive by a caller who may change but not read a file,
// on identical list saves (no archive, no append, an open's trail) and on the cancellation details.
beforeEach(() => resetMockData());

const D = () => doctorAt(0);
const auditSince = (count: number) =>
  getState().clinicAudit.slice(0, getState().clinicAudit.length - count);

/** The second doctor, moved to a custom role holding exactly `keys`. */
function memberWithKeys(keys: string[]): Persona {
  const member = doctorMember(1);
  const base = getState().roles.find((r) => r.id === member.roleId)!;
  const role = { ...base, id: crypto.randomUUID(), systemKey: null, permissions: keys };
  getState().roles.push(role);
  member.roleId = role.id;
  return { kind: "custom", clinicId: member.clinicId, memberId: member.id };
}

describe("archiving without view reach (update:medical:clinic + view:medical:own)", () => {
  it("archives another doctor's file and answers it without the file or uploader name", async () => {
    const { visit } = await startDraft();
    const name = "chest-xray-private.png";
    const up = await api.medical.uploadAttachment(
      D(),
      visit.patientId,
      file("image/png", 50, name),
      null,
    );
    const P = memberWithKeys(["update:medical:clinic", "view:medical:own"]);
    // The file is not one of this member's: its view reach does not cover it.
    await expect(api.medical.listAttachments(P, visit.patientId, {})).rejects.toMatchObject({
      code: "not_found",
    });
    const res = await api.medical.archiveAttachment(P, up.attachment.id);
    expect(res.attachment).toMatchObject({ id: up.attachment.id, status: "archived" });
    expect([res.attachment.name, res.attachment.uploadedByName]).toEqual(["", ""]);
    expect(JSON.stringify(res)).not.toContain(name);
    expect(getState().medical.attachments.find((a) => a.id === up.attachment.id)?.status).toBe(
      "archived",
    );
  });

  it("a caller whose view reach covers the file still gets the names back", async () => {
    const { visit } = await startDraft();
    const up = await api.medical.uploadAttachment(
      D(),
      visit.patientId,
      file("image/png", 50),
      null,
    );
    const res = await api.medical.archiveAttachment(D(), up.attachment.id);
    expect(res.attachment.name).toBe("scan.png");
    expect(res.attachment.uploadedByName).not.toBe("");
  });
});

describe("an identical list save is a no-op", () => {
  it("diagnoses: nothing archived or appended, and the save is logged as an open", async () => {
    const { visit } = await startDraft();
    const input = {
      items: [
        { kind: "icd10" as const, code: "F41.1", text: "Generalized anxiety disorder" },
        { kind: "text" as const, text: "Tension headache" },
      ],
    };
    await api.medical.saveDiagnoses(D(), visit.id, input);
    const stored = getState().medical.visits.find((v) => v.id === visit.id)!;
    const rows = stored.diagnoses.length;
    const before = getState().clinicAudit.length;
    const again = await api.medical.saveDiagnoses(D(), visit.id, input);
    expect(stored.diagnoses.length).toBe(rows);
    expect(stored.diagnoses.every((d) => !d.archived)).toBe(true);
    expect(again.content?.diagnoses.map((d) => d.text)).toEqual([
      "Generalized anxiety disorder",
      "Tension headache",
    ]);
    expect(auditSince(before).map((r) => [r.action, r.category])).toEqual([
      ["visit.opened", "patient_access"],
    ]);
  });

  it("prescription: nothing archived or appended, a blank note equals none, logged as an open", async () => {
    const { visit } = await startDraft();
    const item = { medicine: "Paracetamol", dose: "500 mg", frequency: "8h", duration: "3 days" };
    await api.medical.savePrescription(D(), visit.id, { items: [{ ...item, note: null }] });
    const stored = getState().medical.visits.find((v) => v.id === visit.id)!;
    const rows = stored.prescription.length;
    const before = getState().clinicAudit.length;
    await api.medical.savePrescription(D(), visit.id, { items: [{ ...item, note: "  " }] });
    expect(stored.prescription.length).toBe(rows);
    expect(stored.prescription.every((p) => !p.archived)).toBe(true);
    expect(auditSince(before).map((r) => r.action)).toEqual(["visit.opened"]);
  });

  it("a changed list is still replaced and logged as a save", async () => {
    const { visit } = await startDraft();
    const item = { medicine: "Paracetamol", dose: "500 mg", frequency: "8h", duration: "3 days" };
    await api.medical.savePrescription(D(), visit.id, { items: [{ ...item, note: null }] });
    const before = getState().clinicAudit.length;
    await api.medical.savePrescription(D(), visit.id, {
      items: [{ ...item, dose: "1 g", note: null }],
    });
    const stored = getState().medical.visits.find((v) => v.id === visit.id)!;
    expect(stored.prescription.map((p) => [p.dose, p.archived])).toEqual([
      ["500 mg", true],
      ["1 g", false],
    ]);
    expect(auditSince(before).map((r) => r.action)).toEqual(["visit.prescription_saved"]);
  });
});

describe("the cancellation details", () => {
  it("the reason is metadata for every visit reader; the note travels with the content", async () => {
    const { visit } = await startDraft();
    const cancelled = await api.medical.cancelVisit(D(), visit.id, {
      reason: "patient_left",
      note: "Left before the exam",
    });
    expect(cancelled.visit.cancelReason).toBe("patient_left");
    expect(cancelled.content?.cancelNote).toBe("Left before the exam");
    const list = await api.medical.listVisits(D(), visit.patientId, {});
    expect(list.items.find((v) => v.id === visit.id)?.cancelReason).toBe("patient_left");
    const draft = await startDraft(1);
    expect(draft.visit.cancelReason).toBeNull();
    expect(draft.content?.cancelNote).toBeNull();
  });
});
