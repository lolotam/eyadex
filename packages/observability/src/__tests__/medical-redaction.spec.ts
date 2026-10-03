import { describe, expect, it } from "vitest";

import { createLogger } from "../logger.ts";
import { REDACTED, redactSecrets, sanitize } from "../redaction.ts";

// CLAUDE.md §5 and §8: a civil ID and a birth date are never printed, not even partially — in a log line
// or in an audit snapshot — under whatever spelling the caller used.
const CIVIL = "300000000000";
const BIRTH = "1990-01-01";

const logLine = (entry: Record<string, unknown>): string => {
  let written = "";
  const sink = { write: (chunk: unknown) => void (written += String(chunk)) };
  createLogger("info", { destination: sink, events: ["probe"] }).info(entry, "probe");
  return written;
};

describe("a civil ID is replaced whole at any depth", () => {
  it.each([
    "civilId",
    "civil_id",
    "CIVIL_ID",
    "civilID",
    "civil-id",
    "patientCivilId",
    "civilIdNumber",
    "nationalId",
    "national_id",
  ])("under the key %s", (key) => {
    const line = logLine({ [key]: CIVIL });
    expect(line).not.toContain(CIVIL);
    // Not even one digit of it, and not the tail that a phone rule would have kept.
    expect(line).not.toContain("000");
    expect(JSON.parse(line)).toMatchObject({ [key]: REDACTED });
  });

  it("three levels deep and inside arrays", () => {
    const line = logLine({
      patients: [
        { civilId: CIVIL },
        { profile: { identity: { civil_id: CIVIL } } },
        { links: [{ nationalId: CIVIL }] },
      ],
    });
    expect(line).not.toContain(CIVIL);
    expect(JSON.parse(line)).toMatchObject({
      patients: [
        { civilId: REDACTED },
        { profile: { identity: { civil_id: REDACTED } } },
        { links: [{ nationalId: REDACTED }] },
      ],
    });
  });

  it("in a kept record too — the audit snapshot must not hold it either", () => {
    expect(redactSecrets({ patient: { civilId: CIVIL, name: "SYNTHETIC NAME" } })).toEqual({
      patient: { civilId: REDACTED, name: "SYNTHETIC NAME" },
    });
  });
});

describe("a birth date is replaced whole at any depth", () => {
  it.each(["birthDate", "birth_date", "dateOfBirth", "dob", "DOB"])("under the key %s", (key) => {
    const line = logLine({ [key]: BIRTH });
    expect(line).not.toContain(BIRTH);
    expect(line).not.toContain("1990");
    expect(JSON.parse(line)).toMatchObject({ [key]: REDACTED });
  });

  it("inside an array of snapshots, and next to a field that stays", () => {
    expect(
      sanitize({
        snapshots: [
          { before: { birthDate: BIRTH }, after: { birthDate: BIRTH } },
          { before: { status: "active" } },
        ],
      }),
    ).toEqual({
      snapshots: [
        { before: { birthDate: REDACTED }, after: { birthDate: REDACTED } },
        { before: { status: "active" } },
      ],
    });
  });
});

describe("what the medical rules deliberately over-redact", () => {
  it("a count of civil IDs is replaced as well — a hidden field is cheaper than a leaked one", () => {
    expect(JSON.parse(logLine({ civilIdCount: 3 }))).toMatchObject({ civilIdCount: REDACTED });
  });

  it("phone numbers keep PosPay's rule: last 3 digits only, never the whole number", () => {
    const line = logLine({ patient: { phone: "+965 5001 2345" } });
    expect(line).not.toContain("50012345");
    expect(JSON.parse(line)).toMatchObject({ patient: { phone: "***345" } });
  });

  it("the clinic, branch and request ids a log line legitimately carries are kept", () => {
    expect(
      JSON.parse(
        logLine({
          clinicId: "01920000-0000-7000-8000-00000000c001",
          branchId: "01920000-0000-7000-8000-00000000b001",
          request_id: "01920000-0000-7000-8000-00000000a001",
        }),
      ),
    ).toMatchObject({
      clinicId: "01920000-0000-7000-8000-00000000c001",
      branchId: "01920000-0000-7000-8000-00000000b001",
      request_id: "01920000-0000-7000-8000-00000000a001",
    });
  });
});
