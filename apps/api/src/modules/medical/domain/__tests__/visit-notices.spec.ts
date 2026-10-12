import { describe, expect, it } from "vitest";

import { prescriptionNotice } from "../visit-notices.ts";

const actor = {
  clinicId: "0190a000-0000-7000-8000-0000000000c0",
  membershipId: "0190a000-0000-7000-8000-0000000000c1",
};
const visit = {
  id: "0190a000-0000-7000-8000-0000000000d1",
  patientId: "0190a000-0000-7000-8000-0000000000b1",
};

describe("prescriptionNotice (N-5)", () => {
  it("a signed visit without prescription lines sends nothing", () => {
    expect(prescriptionNotice(visit, 0, actor)).toBeNull();
  });

  it("a signed visit with lines queues one message for its patient, by the signing doctor", () => {
    expect(prescriptionNotice(visit, 2, actor)).toEqual({
      clinicId: actor.clinicId,
      visitId: visit.id,
      patientId: visit.patientId,
      requestedBy: actor.membershipId,
    });
  });
});
