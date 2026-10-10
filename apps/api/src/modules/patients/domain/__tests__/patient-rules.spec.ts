import { describe, expect, it } from "vitest";

import {
  coversBranch,
  duplicateDisclosure,
  isBirthDateAllowed,
  normalizePatientInput,
  patientAuditSnapshot,
  patientScopeFor,
  patientScopes,
  recordActions,
  searchTerms,
  type PatientRecord,
} from "../patient-rules.ts";

const B1 = "0190a000-0000-7000-8000-0000000000b1";
const B2 = "0190a000-0000-7000-8000-0000000000b2";
const ONE = { all: false, branchIds: [B1] } as const;
const EVERY = { all: true } as const;
const M = "0190a000-0000-7000-8000-0000000000c1";

// Fictional, checksum-valid, encodes 1990-04-01 (the web mock's fixture); never a real person's number.
const CIVIL_ID = "290040112347";

const record: PatientRecord = {
  id: "0190a000-0000-7000-8000-0000000000aa",
  fileNumber: 7,
  fullName: "مراجع تجريبي 55501234",
  phone: "+96555501234",
  birthDate: "1990-04-01",
  gender: "male",
  registrationBranchId: B1,
  civilId: CIVIL_ID,
  status: "active",
};

describe("patientScopeFor (PRD §4.7)", () => {
  it("a clinic key covers every branch, whatever the member's branches", () => {
    expect(patientScopeFor(["view:patients:clinic"], ONE, "view", M)).toEqual(EVERY);
  });

  it("a branch key gives the member's branches; all-branches members get every branch", () => {
    expect(patientScopeFor(["view:patients:branch"], ONE, "view", M)).toEqual(ONE);
    expect(patientScopeFor(["view:patients:branch"], EVERY, "view", M)).toEqual(EVERY);
  });

  it("no key of THAT action is no scope: another action's key never stands in", () => {
    expect(patientScopeFor(["view:patients:clinic"], EVERY, "update", M)).toBeNull();
    expect(patientScopeFor(["view:branches:clinic"], EVERY, "view", M)).toBeNull();
    expect(patientScopeFor([], EVERY, "view", M)).toBeNull();
  });
});

describe("patientScopeFor — own (D-4, ADR-0026 A3)", () => {
  it("an own view key is the caller's own files; the wider key held beside it wins", () => {
    expect(patientScopeFor(["view:patients:own"], ONE, "view", M)).toEqual({ own: M });
    expect(patientScopeFor(["view:patients:own", "view:patients:branch"], ONE, "view", M)).toEqual(
      ONE,
    );
    expect(patientScopeFor(["view:patients:own", "view:patients:clinic"], ONE, "view", M)).toEqual(
      EVERY,
    );
  });

  it("own gives view only: no write scope, no branch covered, no record action, no disclosure", () => {
    expect(patientScopeFor(["view:patients:own"], EVERY, "update", M)).toBeNull();
    expect(coversBranch({ own: M }, B1)).toBe(false);
    const scopes = patientScopes(["view:patients:own"], EVERY, M);
    expect(scopes).toEqual({ view: { own: M }, create: null, update: null, deactivate: null });
    expect(recordActions(scopes, B1)).toEqual({ update: false, deactivate: false });
    const existing = { id: record.id, fileNumber: 7, registrationBranchId: B1 };
    expect(duplicateDisclosure(existing, { own: M })).toEqual({ kind: "hidden" });
  });
});

describe("record actions and coverage", () => {
  it("each action is judged under its own scope", () => {
    const scopes = patientScopes(
      ["view:patients:clinic", "update:patients:branch", "deactivate:patients:clinic"],
      ONE,
      M,
    );
    expect(recordActions(scopes, B1)).toEqual({ update: true, deactivate: true });
    expect(recordActions(scopes, B2)).toEqual({ update: false, deactivate: true });
  });

  it("no scope covers nothing", () => {
    expect(coversBranch(null, B1)).toBe(false);
    expect(coversBranch(ONE, B2)).toBe(false);
  });
});

describe("searchTerms (same rule as the mock)", () => {
  it("Arabic-Indic, Persian and full-width digits search like ASCII ones", () => {
    for (const zero of [0x0660, 0x06f0, 0xff10]) {
      const typed = "5550".replace(/\d/g, (d) => String.fromCharCode(zero + Number(d)));
      expect(searchTerms(typed).digitsPattern, zero.toString(16)).toBe("%5550%");
    }
  });

  it("empty search filters nothing", () => {
    expect(searchTerms("")).toEqual({ namePattern: null, digitsPattern: null });
  });

  it("a name escapes LIKE metacharacters and has no digit pattern", () => {
    expect(searchTerms("a_b%c\\")).toEqual({ namePattern: "%a\\_b\\%c\\\\%", digitsPattern: null });
  });

  it("digits are pulled out of any punctuation for phone, file number and civil ID", () => {
    expect(searchTerms("+965 5550-1234").digitsPattern).toBe("%96555501234%");
  });
});

describe("isBirthDateAllowed (clinic time zone, injected clock)", () => {
  const now = new Date("2026-01-31T22:30:00Z"); // already 1 February in Kuwait (UTC+3)

  it("today in the clinic zone is allowed even when it is still yesterday in UTC", () => {
    expect(isBirthDateAllowed("2026-02-01", "Asia/Kuwait", now)).toBe(true);
    expect(isBirthDateAllowed("2026-02-01", "UTC", now)).toBe(false);
  });

  it("an impossible date or an unknown zone is refused", () => {
    expect(isBirthDateAllowed("2025-02-30", "Asia/Kuwait", now)).toBe(false);
    expect(isBirthDateAllowed("1990-01-01", "Not/AZone", now)).toBe(false);
  });
});

describe("normalizePatientInput", () => {
  const input = {
    fullName: "x",
    phone: "5550 1234",
    birthDate: "1990-04-01",
    gender: "female" as const,
    registrationBranchId: B1,
    civilId: "",
  };

  it("canonical phone and an empty civil ID stored as null", () => {
    expect(normalizePatientInput(input)).toMatchObject({ phone: "+96555501234", civilId: null });
  });

  it("an unnormalizable phone is null (the caller refuses it)", () => {
    expect(normalizePatientInput({ ...input, phone: "12" })).toBeNull();
  });
});

describe("patientAuditSnapshot (no civil ID in any form)", () => {
  const snapshot = patientAuditSnapshot(record);

  it("is exactly the allowlist", () => {
    expect(Object.keys(snapshot).sort()).toEqual(
      ["fileNumber", "fullName", "gender", "id", "phone", "registrationBranchId", "status"].sort(),
    );
  });

  it("keeps only the phone's last 3 digits, also inside the name, and never the civil ID", () => {
    const text = JSON.stringify(snapshot);
    expect(snapshot.phone).toBe("***234");
    expect(text).not.toContain("55501234");
    expect(text).not.toContain(CIVIL_ID);
    expect(text).not.toContain("2347");
  });
});

describe("duplicateDisclosure", () => {
  const existing = { id: record.id, fileNumber: 7, registrationBranchId: B2 };

  it("a caller who could open the existing file learns which one it is", () => {
    expect(duplicateDisclosure(existing, EVERY)).toEqual({
      kind: "taken",
      patientId: record.id,
      fileNumber: 7,
    });
  });

  it("anyone else learns nothing", () => {
    expect(duplicateDisclosure(existing, ONE)).toEqual({ kind: "hidden" });
    expect(duplicateDisclosure(existing, null)).toEqual({ kind: "hidden" });
  });
});
