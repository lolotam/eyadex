import { describe, expect, it } from "vitest";

import {
  EMPTY_NOTE,
  changedFields,
  isSignable,
  mayAttach,
  medicalReach,
  medicalReachCovers,
  startFromAppointmentProblem,
  visitAbilities,
  visitReachSees,
  visitViewReach,
  visitWriteProblem,
  walkInReaches,
  worksIn,
  type MedicalActor,
} from "../visit-rules.ts";

// Spec §2 and §4, P2-2…P2-6, R1-18 (ADR-0029).
const me = "m-1";
// Files inside the caller's patients view reach: one of its own patients, and another's.
const ownFile = { own: true, inPatientReach: true };
const othersFile = { own: false, inPatientReach: true };
const other = "m-2";
const actor = (permissions: string[]): MedicalActor => ({
  clinicId: "c",
  userId: "u",
  membershipId: me,
  language: "ar",
  permissions,
  member: { all: false, branchIds: ["b1"] },
});

describe("visitViewReach — the wider key wins", () => {
  it("clinic, then branch, then own, else nothing", () => {
    const all = ["view:visits:clinic", "view:visits:branch", "view:visits:own"];
    expect(visitViewReach(actor(all))).toEqual({ all: true });
    expect(visitViewReach(actor(all.slice(1)))).toEqual({ all: false, branchIds: ["b1"] });
    expect(visitViewReach(actor(["view:visits:own"]))).toEqual({ own: me });
    expect(visitViewReach(actor(["view:patients:clinic"]))).toBeNull();
  });

  it("own sees every visit of an own patient, whoever wrote it (P2-4); branch looks at the visit", () => {
    expect(visitReachSees({ own: me }, { branchId: "b9" }, true)).toBe(true);
    expect(visitReachSees({ own: me }, { branchId: "b1" }, false)).toBe(false);
    expect(visitReachSees({ all: false, branchIds: ["b1"] }, { branchId: "b1" }, false)).toBe(true);
    expect(visitReachSees({ all: false, branchIds: ["b1"] }, { branchId: "b2" }, true)).toBe(false);
    expect(visitReachSees(null, { branchId: "b1" }, true)).toBe(false);
  });
});

describe("medicalReach — P2-5: no key, no content", () => {
  it("view:medical:clinic wins over own; none is null", () => {
    expect(medicalReach(actor(["view:medical:clinic", "view:medical:own"]), "view")).toEqual({
      all: true,
    });
    expect(medicalReach(actor(["view:medical:own"]), "view")).toEqual({ own: me });
    expect(medicalReach(actor(["view:medical:own"]), "update")).toBeNull();
    expect(medicalReach(actor(["view:visits:clinic"]), "view")).toBeNull();
  });

  it("own content covers own patients only", () => {
    expect(medicalReachCovers({ own: me }, ownFile)).toBe(true);
    expect(medicalReachCovers({ own: me }, othersFile)).toBe(false);
    expect(medicalReachCovers({ all: true }, othersFile)).toBe(true);
    expect(medicalReachCovers(null, ownFile)).toBe(false);
  });

  // Owner decision 2026-10-11: medical content stays inside the patients view reach.
  it.each([
    ["all", { all: true }],
    ["own", { own: me }],
  ] as const)("a file outside the patients reach is never covered (%s)", (_s, reach) => {
    expect(medicalReachCovers(reach, { own: true, inPatientReach: false })).toBe(false);
  });
});

describe("startFromAppointmentProblem — P2-2", () => {
  it("only the appointment's provider, only once the patient arrived", () => {
    expect(startFromAppointmentProblem({ status: "arrived", providerMembershipId: me }, me)).toBe(
      null,
    );
    expect(startFromAppointmentProblem({ status: "booked", providerMembershipId: me }, me)).toBe(
      "appointment_not_arrived",
    );
    expect(
      startFromAppointmentProblem({ status: "arrived", providerMembershipId: other }, me),
    ).toBe("forbidden");
  });
});

describe("visitWriteProblem — P2-3, P2-6", () => {
  const visit = (status: "draft" | "signed" | "cancelled", provider = me) => ({
    status,
    providerMembershipId: provider,
  });

  it("only the visit's provider writes, whatever the status", () => {
    for (const write of ["note", "sign", "cancel", "addendum"] as const) {
      expect(visitWriteProblem(visit("draft", other), me, write)).toBe("visit_not_provider");
    }
  });

  it("a draft is edited, signed and cancelled, and takes no addendum", () => {
    expect(visitWriteProblem(visit("draft"), me, "note")).toBeNull();
    expect(visitWriteProblem(visit("draft"), me, "sign")).toBeNull();
    expect(visitWriteProblem(visit("draft"), me, "cancel")).toBeNull();
    expect(visitWriteProblem(visit("draft"), me, "addendum")).toBe("visit_not_signed");
  });

  it("a signed visit only gains addenda", () => {
    expect(visitWriteProblem(visit("signed"), me, "note")).toBe("visit_signed");
    expect(visitWriteProblem(visit("signed"), me, "sign")).toBe("visit_signed");
    expect(visitWriteProblem(visit("signed"), me, "cancel")).toBe("visit_signed");
    expect(visitWriteProblem(visit("signed"), me, "addendum")).toBeNull();
  });

  it("a cancelled draft takes nothing", () => {
    for (const write of ["note", "sign", "cancel", "addendum"] as const) {
      expect(visitWriteProblem(visit("cancelled"), me, write)).toBe("invalid_transition");
    }
  });
});

describe("isSignable — spec §4", () => {
  it("needs one non-empty note section or one diagnosis", () => {
    expect(isSignable(EMPTY_NOTE, 0)).toBe(false);
    expect(isSignable({ ...EMPTY_NOTE, plan: "   " }, 0)).toBe(false);
    expect(isSignable({ ...EMPTY_NOTE, plan: "راحة" }, 0)).toBe(true);
    expect(isSignable(EMPTY_NOTE, 1)).toBe(true);
  });
});

describe("visitAbilities", () => {
  const draft = { status: "draft" as const, providerMembershipId: me };

  it("the provider holding update:medical gets the draft's buttons; sign waits for content", () => {
    const doctor = actor(["update:medical:own"]);
    expect(visitAbilities(doctor, draft, ownFile, false)).toEqual({
      edit: true,
      sign: false,
      cancel: true,
      addAddendum: false,
    });
    expect(visitAbilities(doctor, draft, ownFile, true).sign).toBe(true);
    expect(visitAbilities(doctor, { ...draft, status: "signed" }, ownFile, true)).toEqual({
      edit: false,
      sign: false,
      cancel: false,
      addAddendum: true,
    });
  });

  it("nothing without the update key, and nothing for another provider", () => {
    const none = { edit: false, sign: false, cancel: false, addAddendum: false };
    expect(visitAbilities(actor(["view:medical:clinic"]), draft, ownFile, true)).toEqual(none);
    expect(
      visitAbilities(
        actor(["update:medical:clinic"]),
        { ...draft, providerMembershipId: other },
        ownFile,
        true,
      ),
    ).toEqual(none);
  });
});

describe("visitAbilities outside the patients reach (Codex 4241757308)", () => {
  it("the provider gets no button on a file outside its patients reach, as its writes are not_found", () => {
    const outside = { own: true, inPatientReach: false };
    const draft = { status: "draft" as const, providerMembershipId: me };
    const none = { edit: false, sign: false, cancel: false, addAddendum: false };
    expect(visitAbilities(actor(["update:medical:clinic"]), draft, outside, true)).toEqual(none);
    const signed = { ...draft, status: "signed" as const };
    expect(visitAbilities(actor(["update:medical:own"]), signed, outside, true)).toEqual(none);
  });
});

describe("mayAttach — the upload rule, not the provider's", () => {
  it("update:medical reaching the patient on an active file, whoever the provider is", () => {
    expect(mayAttach(actor(["update:medical:own"]), ownFile, true)).toBe(true);
    expect(mayAttach(actor(["update:medical:clinic"]), othersFile, true)).toBe(true);
  });

  it("no attachment for an archived file, outside the own reach, or without the update key", () => {
    expect(mayAttach(actor(["update:medical:clinic"]), ownFile, false)).toBe(false);
    expect(mayAttach(actor(["update:medical:own"]), othersFile, true)).toBe(false);
    expect(mayAttach(actor(["view:medical:clinic"]), ownFile, true)).toBe(false);
    expect(
      mayAttach(actor(["update:medical:clinic"]), { own: true, inPatientReach: false }, true),
    ).toBe(false);
  });
});

describe("changedFields — names only (R3-4)", () => {
  it("lists the keys whose value moved, nulls included", () => {
    expect(
      changedFields(
        { complaint: "a", examination: null, assessment: "b", plan: "c" },
        { complaint: "a", examination: "x", assessment: null, plan: "c" },
      ),
    ).toEqual(["examination", "assessment"]);
  });
});

describe("walk-in — R3-1", () => {
  it("the caller works in the branch, and the file belongs to it", () => {
    expect(worksIn({ all: true }, "b9")).toBe(true);
    expect(worksIn({ all: false, branchIds: ["b1"] }, "b9")).toBe(false);
    expect(walkInReaches({ registrationBranchId: "b1" }, "b1")).toBe(true);
    expect(walkInReaches({ registrationBranchId: "b2" }, "b1")).toBe(false);
  });
});
