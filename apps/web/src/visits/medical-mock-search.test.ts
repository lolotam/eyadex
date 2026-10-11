import { beforeEach, describe, expect, it } from "vitest";
import type { Persona } from "@eyadex/contracts/session";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { api, doctorAt, doctorMember, getState, startDraft } from "./medical-test-kit";

// PR #68 review: the mock's note search answers as the API's `searchVisitPage` — the visit's parts
// joined, the query split into words found in any order, Arabic letter forms and digits folded.
beforeEach(() => resetMockData());

const D = () => doctorAt(0);

/** A draft of the first doctor with this assessment and these diagnoses saved. */
async function visitWith(assessment: string, diagnoses: { code?: string; text: string }[]) {
  const { visit } = await startDraft();
  const note = { complaint: null, examination: null, assessment, plan: null };
  await api.medical.saveNote(D(), visit.id, note);
  const items = diagnoses.map(({ code, text }) =>
    code ? { kind: "icd10" as const, code, text } : { kind: "text" as const, text },
  );
  await api.medical.saveDiagnoses(D(), visit.id, { items });
  return visit;
}

const found = async (persona: Persona, patientId: string, q: string) =>
  (await api.medical.searchVisits(persona, patientId, { q })).items.map((v) => v.id);

describe("the mock's visit search", () => {
  it("matches words split across the assessment and a diagnosis, in any order", async () => {
    const visit = await visitWith("ضغط مرتفع", [{ text: "صداع نصفي" }]);
    expect(await found(D(), visit.patientId, "صداع ضغط")).toEqual([visit.id]);
    expect(await found(D(), visit.patientId, "صداع سكر")).toEqual([]);
  });

  it.each([
    ["alef forms", "ألم في الرأس", "الم الراس"],
    ["taa marbuta and alef maqsura", "حرارة مع حمى", "حراره حمي"],
    ["Arabic-Indic digits in the query", "حرارة 38", "٣٨"],
    ["Arabic-Indic digits in the text", "حرارة ٣٨", "38"],
  ])("folds %s as the API", async (_case, assessment, q) => {
    const visit = await visitWith(assessment, []);
    expect(await found(D(), visit.patientId, q)).toEqual([visit.id]);
  });

  it("searches an active diagnosis's ICD-10 code too", async () => {
    const visit = await visitWith("Follow-up", [
      { code: "F41.1", text: "Generalized anxiety disorder" },
    ]);
    expect(await found(D(), visit.patientId, "f41.1")).toEqual([visit.id]);
  });

  it("a branch visits key scans only that branch's visits, as the API's reach", async () => {
    const visit = await visitWith("ضغط مرتفع", []);
    const member = doctorMember(1);
    const base = getState().roles.find((r) => r.id === member.roleId)!;
    const keys = ["view:medical:clinic", "view:visits:branch"];
    getState().roles.push({
      ...base,
      id: "role-branch-reader",
      systemKey: null,
      permissions: keys,
    });
    member.roleId = "role-branch-reader";
    member.allBranches = false;
    const P: Persona = { kind: "custom", clinicId: member.clinicId, memberId: member.id };
    member.branchIds = getState()
      .branches.filter((b) => b.clinicId === member.clinicId && b.id !== visit.branchId)
      .map((b) => b.id);
    expect(await found(P, visit.patientId, "ضغط")).toEqual([]);
    member.branchIds = [visit.branchId];
    expect(await found(P, visit.patientId, "ضغط")).toEqual([visit.id]);
  });
});

// The API's walk-in search (`PgMedicalPatients.walkInCandidates`): the query's digits (Arabic-Indic
// folded, anything else dropped) anywhere in the six-digit padded file number, or the name contains it.
describe("walk-in candidates by file number, as the API", () => {
  it.each([
    ["104", true],
    ["1042", true],
    ["١٠٤٢", true],
    ["001042", true],
    ["0010", true],
    ["file 1042", true],
    ["1043", false],
  ])("%s finds file 1042: %s", async (q, hit) => {
    const { items: branches } = await api.medical.walkInBranches(D());
    const branchId = branches[0]!.id;
    const patient = getState().patients.find(
      (p) => p.registrationBranchId === branchId && p.status === "active",
    )!;
    patient.fileNumber = 1042;
    const { items } = await api.medical.walkInCandidates(D(), { branchId, q });
    expect(items.some((c) => c.patientId === patient.id)).toBe(hit);
  });
});
