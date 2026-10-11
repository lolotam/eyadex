import { beforeEach, describe, expect, it } from "vitest";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { api, doctorAt, doctorMember, getState } from "./medical-test-kit";

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
