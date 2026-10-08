import { describe, expect, it } from "vitest";

import { scrubPatientAuditDetails, scrubPatientAuditText } from "../patient-audit-text.ts";

// Fictional, checksum-valid civil ID (the web mock's fixture) and a fictional 5550 phone; synthetic only.
const CIVIL_ID = "290040112347";
const PHONE = "55501234";
const fullWidth = (digits: string) =>
  digits.replace(/\d/g, (d) => String.fromCharCode(0xff10 + Number(d)));
const arabicIndic = (digits: string) =>
  digits.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));

describe("scrubPatientAuditText", () => {
  it.each([
    ["glued to a word", `Test${CIVIL_ID}`],
    ["in full-width digits", `Test ${fullWidth(CIVIL_ID)}`],
    ["in Arabic-Indic digits", `مراجع${arabicIndic(CIVIL_ID)}`],
    ["split by spaces", `Test ${CIVIL_ID.replace(/(\d{4})/g, "$1 ")}`],
  ])("a civil ID %s is removed whole", (_label, text) => {
    const out = scrubPatientAuditText(text);
    expect(out).toContain("[REDACTED]");
    expect(out.replace(/\D/g, "")).toBe("");
  });

  it.each([
    ["glued to a word", `Test${PHONE}`],
    ["in full-width digits", `Test${fullWidth(PHONE)}`],
    ["in Arabic-Indic digits", `Test${arabicIndic(PHONE)}`],
    ["with a country code", `Test +965 ${PHONE}`],
  ])("a phone %s keeps its last 3 digits only", (_label, text) => {
    const out = scrubPatientAuditText(text);
    expect(out).toMatch(/\*\*\*234$/);
    expect(out.replace(/\D/g, "")).toBe("234");
  });

  it("leaves a name without long digit runs as it is", () => {
    expect(scrubPatientAuditText("Noura Al-Ali 3")).toBe("Noura Al-Ali 3");
  });
});

describe("scrubPatientAuditDetails", () => {
  it("scrubs every string at any depth and keeps UUIDs and numbers", () => {
    const id = "01a118ec-3185-7119-9bfc-1b7232f3bd00";
    const out = scrubPatientAuditDetails({
      before: null,
      after: { id, fileNumber: 12, fullName: `x${CIVIL_ID}`, tags: [[`y${PHONE}`]] },
    });
    expect(out).toEqual({
      before: null,
      after: { id, fileNumber: 12, fullName: "x[REDACTED]", tags: [["y***234"]] },
    });
  });
});
