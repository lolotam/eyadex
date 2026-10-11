import { beforeEach, describe, expect, it } from "vitest";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { api, doctorAt, doctorMember, getState } from "./medical-test-kit";

// The walk-in branch checks in the API's order (visit-reads.ts, start-visit.ts).
const reject = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });

beforeEach(() => resetMockData());

/** The first doctor, moved to every branch; a closed branch of its clinic and an active file there. */
function everyBranchWithClosedBranch() {
  const db = getState();
  doctorMember(0).allBranches = true;
  const clinicId = db.clinics[0]!.id;
  const template = db.branches.find((b) => b.clinicId === clinicId)!;
  const closed = { ...template, id: crypto.randomUUID(), isActive: false };
  db.branches.push(closed);
  const sample = db.patients.find((p) => p.clinicId === clinicId && p.status === "active")!;
  const filed = {
    ...sample,
    id: crypto.randomUUID(),
    fullName: "Closed branch file",
    registrationBranchId: closed.id,
  };
  db.patients.push(filed);
  return { closedId: closed.id, filedId: filed.id };
}

describe("walk-in in a closed branch (Codex 4241493936)", () => {
  it("candidates: a closed branch is branch_inactive, an unknown one not_found, neither audited", async () => {
    const { closedId } = everyBranchWithClosedBranch();
    const audited = getState().clinicAudit.length;
    const search = (branchId: string) =>
      api.medical.walkInCandidates(doctorAt(0), { branchId, q: "Closed branch" });
    await reject(search(closedId), "branch_inactive");
    await reject(search(crypto.randomUUID()), "not_found");
    expect(getState().clinicAudit).toHaveLength(audited);
  });

  it("start: a file of a closed branch is branch_inactive, not forbidden", async () => {
    const { closedId, filedId } = everyBranchWithClosedBranch();
    const before = getState().medical.visits.length;
    await reject(
      api.medical.startVisit(
        doctorAt(0),
        { patientId: filedId, branchId: closedId },
        crypto.randomUUID(),
      ),
      "branch_inactive",
    );
    expect(getState().medical.visits).toHaveLength(before);
  });

  it("start: another branch's archived file is not_found before its status is told", async () => {
    const db = getState();
    const branchId = (await api.medical.walkInBranches(doctorAt(0))).items[0]!.id;
    const elsewhere = db.patients.find(
      (p) => p.clinicId === db.clinics[0]!.id && p.registrationBranchId !== branchId,
    )!;
    elsewhere.status = "archived";
    await reject(
      api.medical.startVisit(
        doctorAt(0),
        { patientId: elsewhere.id, branchId },
        crypto.randomUUID(),
      ),
      "not_found",
    );
  });
});
