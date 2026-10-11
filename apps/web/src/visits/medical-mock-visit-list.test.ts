import { beforeEach, describe, expect, it } from "vitest";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { api, doctorAt, doctorMember, getState, startDraft } from "./medical-test-kit";

// PR #68 review: a visit list offers the walk-in start only where the API's `canStart` would, so the
// button never leads to a start the API refuses.
beforeEach(() => resetMockData());

/** An active file of the first doctor's clinic; the doctor then works in `branch` only. */
function doctorWorkingIn(branch: "the file's" | "another") {
  const member = doctorMember(0);
  const db = getState();
  const patient = db.patients.find((p) => p.clinicId === member.clinicId && p.status === "active")!;
  const other = db.branches.find(
    (b) => b.clinicId === member.clinicId && b.isActive && b.id !== patient.registrationBranchId,
  )!;
  member.allBranches = false;
  member.branchIds = [branch === "the file's" ? patient.registrationBranchId : other.id];
  return patient;
}

const canStart = async (patientId: string) =>
  (await api.medical.listVisits(doctorAt(0), patientId, {})).can.start;

describe("a visit list's walk-in start", () => {
  it("is offered for an active file of a branch the caller works in", async () => {
    const patient = doctorWorkingIn("the file's");
    expect(await canStart(patient.id)).toBe(true);
  });

  it("is not offered for an archived file", async () => {
    const patient = doctorWorkingIn("the file's");
    patient.status = "archived";
    expect(await canStart(patient.id)).toBe(false);
  });

  it("is not offered for a file registered in a branch the caller does not work in", async () => {
    const patient = doctorWorkingIn("another");
    expect(await canStart(patient.id)).toBe(false);
  });
});

describe("a visit list's preview (Codex PR #68): null without an assessment, as the API's previewOf", () => {
  it.each([
    ["no assessment", null, null, false],
    ["an assessment", "Tension headache", "Tension headache", true],
  ])("a content reader of a visit with %s", async (_case, assessment, preview, audited) => {
    const D = doctorAt(0);
    const { visit } = await startDraft();
    // The file's other visits carry no assessment, so only this one can show a preview.
    for (const v of getState().medical.visits) {
      if (v.patientId === visit.patientId) v.note.assessment = null;
    }
    const note = { complaint: "Headache", examination: null, assessment, plan: null };
    await api.medical.saveNote(D, visit.id, note);
    const before = getState().clinicAudit.length;
    const list = await api.medical.listVisits(D, visit.patientId, {});
    const added = getState().clinicAudit.slice(0, getState().clinicAudit.length - before);
    expect(list.items.find((v) => v.id === visit.id)?.preview).toBe(preview);
    expect(added.some((r) => r.action === "visit.previews_listed")).toBe(audited);
  });
});
