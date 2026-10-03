import { describe, expect, it } from "vitest";
import {
  civilIdBirthDate,
  isValidKuwaitCivilId,
  normalizeCivilId,
  patientInputSchema,
} from "@eyadex/contracts/patients";

// Well-formed fictional numbers, each one with the birth date its digits 1-7 encode.
const A = "290040112347"; // 1990-04-01
const A_SAME_DATE = "290040199999"; // 1990-04-01, different serial
const B = "291060243218"; // 1991-06-02
const C = "305090900009"; // 2005-09-09
const LEAP_20TH = "296022910019"; // 1996-02-29
const LEAP_21ST = "300022967903"; // 2000-02-29

/** Every issue message on the civilId path, in order. */
function civilIdIssues(parsed: {
  success: boolean;
  error?: { issues: { path: unknown[]; message: string }[] };
}) {
  if (parsed.success) return [];
  return parsed.error?.issues.filter((i) => i.path[0] === "civilId").map((i) => i.message) ?? [];
}

const BASE = {
  fullName: "مراجع تجريبي",
  phone: "55501234",
  birthDate: "1990-04-01",
  gender: "male" as const,
  registrationBranchId: "00000000-0000-4000-8000-000000000001",
};

describe("Kuwaiti civil ID: shape, date and checksum", () => {
  it("normalizes Arabic-Indic and Persian digits, spaces and dashes to ASCII", () => {
    expect(normalizeCivilId("٢٩٠٠٤٠١١٢٣٤٧")).toBe(A);
    expect(normalizeCivilId("۲۹۰۰۴۰۱۱۲۳۴۷")).toBe(A);
    expect(normalizeCivilId(" 290-040 112-347 ")).toBe(A);
    expect(normalizeCivilId("")).toBe("");
    // Normalization is not validation: nonsense in, nonsense out.
    expect(normalizeCivilId("29004011234x")).toBe("29004011234x");
  });

  it("accepts a well-formed number from either century", () => {
    for (const id of [A, A_SAME_DATE, B, C, LEAP_20TH, LEAP_21ST]) {
      expect(isValidKuwaitCivilId(id)).toBe(true);
    }
  });

  it("refuses anything that is not 12 ASCII digits", () => {
    for (const id of [
      "",
      "29004011234",
      "2900401123477",
      "29004011234X",
      "29004011234 ",
      "٢٩٠٠٤٠١١٢٣٤٧",
      "۲۹۰۰۴۰۱۱۲۳۴۷",
      "29004011234\n",
    ]) {
      expect(isValidKuwaitCivilId(id)).toBe(false);
    }
  });

  it("refuses an unknown century digit", () => {
    expect(isValidKuwaitCivilId("190040112349")).toBe(false);
    expect(isValidKuwaitCivilId("490040112349")).toBe(false);
  });

  it("refuses digits 2-7 that are not a real calendar date", () => {
    // Every one of these carries a correct checksum, so only the date can refuse them.
    expect(isValidKuwaitCivilId("290023011114")).toBe(false); // 1990-02-30
    expect(isValidKuwaitCivilId("290022910003")).toBe(false); // 1990-02-29, not a leap year
    expect(isValidKuwaitCivilId("200022900006")).toBe(false); // 1900-02-29, never a leap year
    expect(isValidKuwaitCivilId("291320100001")).toBe(false); // month 13
    expect(isValidKuwaitCivilId("291300100006")).toBe(false); // day 00
  });

  it("honours leap years", () => {
    expect(isValidKuwaitCivilId(LEAP_20TH)).toBe(true);
    expect(isValidKuwaitCivilId(LEAP_21ST)).toBe(true);
  });

  it("refuses a wrong checksum, and a date whose checksum digit would be 10", () => {
    expect(isValidKuwaitCivilId("290040112345")).toBe(false);
    expect(isValidKuwaitCivilId("290040112348")).toBe(false);
    // 1970-01-06 serial 0000 needs check digit 10, which is not a digit.
    expect(isValidKuwaitCivilId("270010600000")).toBe(false);
  });

  it("reads the encoded birth date, or null for anything invalid", () => {
    expect(civilIdBirthDate(A)).toBe("1990-04-01");
    expect(civilIdBirthDate(A_SAME_DATE)).toBe("1990-04-01");
    expect(civilIdBirthDate(B)).toBe("1991-06-02");
    expect(civilIdBirthDate(C)).toBe("2005-09-09");
    expect(civilIdBirthDate(LEAP_21ST)).toBe("2000-02-29");
    expect(civilIdBirthDate("290040112345")).toBeNull();
    expect(civilIdBirthDate("290023011114")).toBeNull();
    expect(civilIdBirthDate("")).toBeNull();
  });
});

describe("patient input: civil ID is optional, normalized and must match the birth date", () => {
  it("keeps an empty civil ID as none", () => {
    for (const empty of ["", "   "]) {
      const parsed = patientInputSchema.safeParse({ ...BASE, civilId: empty });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.civilId).toBe("");
    }
  });

  it("stores the normalized number, not what was typed", () => {
    for (const typed of [A, " ٢٩٠٠٤٠١١٢٣٤٧ ", "۲۹۰۰۴۰۱۱۲۳۴۷", "290-040-112-347"]) {
      const parsed = patientInputSchema.safeParse({ ...BASE, civilId: typed });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.civilId).toBe(A);
    }
  });

  it("issues validation.civilId for a malformed number", () => {
    for (const bad of [
      "29004011234", // 11 digits
      "290040112345", // wrong checksum
      "٢٩٠٠٤٠١١٢٣٤", // 11 Arabic-Indic digits
      "290023011114", // no such calendar date
    ]) {
      expect(civilIdIssues(patientInputSchema.safeParse({ ...BASE, civilId: bad }))).toEqual([
        "validation.civilId",
      ]);
    }
  });

  it("issues validation.civilIdBirthDate when the number and the date disagree", () => {
    const parsed = patientInputSchema.safeParse({ ...BASE, civilId: C });
    expect(civilIdIssues(parsed)).toEqual(["validation.civilIdBirthDate"]);
  });

  it("accepts a number that encodes the entered birth date", () => {
    expect(patientInputSchema.safeParse({ ...BASE, civilId: A }).success).toBe(true);
    const other = patientInputSchema.safeParse({ ...BASE, birthDate: "2005-09-09", civilId: C });
    expect(other.success).toBe(true);
  });

  it("reports only the malformed number, never a second birth-date complaint", () => {
    const parsed = patientInputSchema.safeParse({ ...BASE, civilId: "290040112345" });
    expect(civilIdIssues(parsed)).toEqual(["validation.civilId"]);
  });

  it("does not guess a date when the birth date is still missing", () => {
    const parsed = patientInputSchema.safeParse({ ...BASE, birthDate: "", civilId: A });
    expect(parsed.success).toBe(false);
    expect(civilIdIssues(parsed)).toEqual([]);
  });
});
