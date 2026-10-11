import { beforeEach, describe, expect, it } from "vitest";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { api, doctorAt, getState, startDraft } from "./medical-test-kit";

// Parity sweep: the API's read rows (visit-reads.ts) — a read across a patient's visits names the
// patient, and the walk-in search names no record at all.
beforeEach(() => resetMockData());

const D = () => doctorAt(0);
const row = (action: string) => {
  const found = getState().clinicAudit.find((e) => e.action === action)!;
  return { entity: found.entity, entityId: found.entityId, category: found.category };
};

describe("the medical read rows", () => {
  it("previews listed and a note search name the patient", async () => {
    const { visit } = await startDraft();
    const note = { complaint: null, examination: null, assessment: "Migraine", plan: null };
    await api.medical.saveNote(D(), visit.id, note);
    await api.medical.listVisits(D(), visit.patientId, {});
    await api.medical.searchVisits(D(), visit.patientId, { q: "Migraine" });
    const patient = { entity: "patient", entityId: visit.patientId, category: "patient_access" };
    expect([row("visit.previews_listed"), row("visit.searched")]).toEqual([patient, patient]);
  });

  it("a walk-in search is a row about no single record", async () => {
    const branchId = (await api.medical.walkInBranches(D())).items[0]!.id;
    await api.medical.walkInCandidates(D(), { branchId, q: "al" });
    expect(row("visit.walk_in_searched")).toEqual({
      entity: "visit",
      entityId: null,
      category: "patient_access",
    });
  });
});
